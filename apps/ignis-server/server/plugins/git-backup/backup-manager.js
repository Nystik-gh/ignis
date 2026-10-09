const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { sanitizeError } = require("@ignis/server-core");
const { GIT_DEPENDENCY, GitRepository } = require("./git");

const DEFAULT_INTERVAL_SECONDS = 60;

function isValidInterval(value) {
  return Number.isInteger(value) && value >= 10 && value <= 3600;
}

class BackupManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.git = new GitRepository(ctx.dependencies.require(GIT_DEPENDENCY.name));
    this.states = new Map();
    this.enabling = new Map();
  }

  vaultDataDir(vaultId) {
    const key = createHash("sha256").update(vaultId).digest("hex");
    return path.join(this.ctx.dataDir, key);
  }

  getState(vaultId) {
    const state = this.states.get(vaultId);

    if (!state) {
      return null;
    }

    return {
      vaultId,
      intervalSeconds: state.intervalSeconds,
      status: state.status,
      lastCheckedAt: state.lastCheckedAt,
      lastCommit: state.lastCommit,
      lastCommitAt: state.lastCommitAt,
      error: state.error,
    };
  }

  enableVault(vaultId, vaultPath) {
    if (this.enabling.has(vaultId)) {
      return this.enabling.get(vaultId);
    }

    if (this.states.has(vaultId)) {
      return Promise.resolve();
    }

    const pending = this.loadVault(vaultId, vaultPath).finally(() => {
      this.enabling.delete(vaultId);
    });
    this.enabling.set(vaultId, pending);
    return pending;
  }

  async loadVault(vaultId, vaultPath) {
    const vaultDir = await fs.promises.realpath(vaultPath);
    const dataDir = await fs.promises.realpath(this.ctx.dataDir);
    const relative = path.relative(vaultDir, dataDir);

    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    ) {
      throw Object.assign(
        new Error("Backup data directory must be outside the vault"),
        { code: "BACKUP_DATA_IN_VAULT" },
      );
    }

    const vaultDataDir = this.vaultDataDir(vaultId);
    await fs.promises.mkdir(vaultDataDir, { recursive: true });

    let intervalSeconds = DEFAULT_INTERVAL_SECONDS;

    try {
      const saved = JSON.parse(
        await fs.promises.readFile(
          path.join(vaultDataDir, "config.json"),
          "utf-8",
        ),
      );

      if (isValidInterval(saved.intervalSeconds)) {
        intervalSeconds = saved.intervalSeconds;
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        this.ctx.log(
          `Failed to load backup settings for ${vaultId}: ${e.message}`,
        );
      }
    }

    await fs.promises.writeFile(
      path.join(vaultDataDir, "config.json"),
      JSON.stringify({ vaultId, intervalSeconds }, null, 2),
    );

    const state = {
      vaultId,
      vaultPath,
      repositoryPath: path.join(vaultDataDir, "repository.git"),
      initialized: false,
      intervalSeconds,
      status: "idle",
      lastCheckedAt: null,
      lastCommit: null,
      lastCommitAt: null,
      error: null,
      timer: null,
      pending: null,
      stopping: false,
    };

    this.states.set(vaultId, state);
    // A failed initial backup remains visible and is retried on the next interval.
    await this.backup(vaultId).catch(() => {});
  }

  schedule(state) {
    clearTimeout(state.timer);

    if (state.stopping) {
      return;
    }

    state.timer = setTimeout(() => {
      this.backup(state.vaultId).catch(() => {});
    }, state.intervalSeconds * 1000);
    state.timer.unref();
  }

  backup(vaultId) {
    const state = this.states.get(vaultId);

    if (!state || state.stopping) {
      return Promise.reject(
        new Error("Git Backup is not enabled for this vault"),
      );
    }

    // Timer and manual requests share a single operation per vault.
    if (state.pending) {
      return state.pending;
    }

    clearTimeout(state.timer);
    state.status = "running";
    state.error = null;
    state.pending = this.createSnapshot(state)
      .then((committed) => {
        state.status = "idle";
        state.lastCheckedAt = new Date().toISOString();
        return { committed, state: this.getState(vaultId) };
      })
      .catch((e) => {
        state.status = "error";
        state.lastCheckedAt = new Date().toISOString();
        state.error = sanitizeError(e).error;
        this.ctx.log(`Backup failed for ${vaultId}: ${e.message}`);
        throw e;
      })
      .finally(() => {
        state.pending = null;
        this.schedule(state);
      });

    return state.pending;
  }

  async createSnapshot(state) {
    const { vaultId, vaultPath, repositoryPath } = state;

    await this.validateVault(state);

    if (!state.initialized) {
      if (!fs.existsSync(path.join(repositoryPath, "HEAD"))) {
        await this.git.initialize(vaultPath, repositoryPath);
      }

      await fs.promises.mkdir(path.join(repositoryPath, "info"), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(repositoryPath, "info", "exclude"),
        "/.git\n/.obsidian/workspace.json\n/.obsidian/workspace-mobile.json\n",
      );
      state.initialized = true;
    }

    const result = await this.git.snapshot(vaultPath, repositoryPath, () =>
      this.validateVault(state),
    );
    state.lastCommit = result.lastCommit;
    state.lastCommitAt = result.lastCommitAt;

    if (result.committed) {
      this.ctx.log(
        `Backup committed for ${vaultId}: ${state.lastCommit.slice(0, 8)}`,
      );
    }

    return result.committed;
  }

  async validateVault({ vaultId, vaultPath }) {
    // Do not turn a removed or renamed vault into a snapshot of deletions.
    if (this.ctx.config.getVaultPath(vaultId) !== vaultPath) {
      throw Object.assign(new Error("Vault no longer exists"), {
        code: "ENOENT",
      });
    }

    const stat = await fs.promises.stat(vaultPath);

    if (!stat.isDirectory()) {
      throw Object.assign(new Error("Vault is not a directory"), {
        code: "ENOTDIR",
      });
    }
  }

  async configureVault(vaultId, intervalSeconds) {
    if (!isValidInterval(intervalSeconds)) {
      throw new Error("intervalSeconds must be an integer between 10 and 3600");
    }

    const state = this.states.get(vaultId);

    if (!state || state.stopping) {
      throw new Error("Git Backup is not enabled for this vault");
    }

    await fs.promises.writeFile(
      path.join(this.vaultDataDir(vaultId), "config.json"),
      JSON.stringify({ vaultId, intervalSeconds }, null, 2),
    );
    state.intervalSeconds = intervalSeconds;

    if (!state.pending) {
      this.schedule(state);
    }

    return this.getState(vaultId);
  }

  async disableVault(vaultId) {
    await this.enabling.get(vaultId)?.catch(() => {});
    const state = this.states.get(vaultId);

    if (!state) {
      return;
    }

    state.stopping = true;
    clearTimeout(state.timer);
    await state.pending?.catch(() => {});
    this.states.delete(vaultId);
  }

  async shutdown() {
    const vaultIds = new Set([...this.states.keys(), ...this.enabling.keys()]);
    await Promise.all(
      [...vaultIds].map((vaultId) => this.disableVault(vaultId)),
    );
  }
}

module.exports = { BackupManager, isValidInterval };
