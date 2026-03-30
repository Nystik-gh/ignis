const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { spawnOb, runCommand } = require("./ob-cli");

const MAX_LOG_ENTRIES = 200;

function killProcess(proc) {
  if (!proc) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"]);
  } else {
    proc.kill("SIGTERM");
  }
}

class SyncManager {
  constructor(ctx, broadcaster) {
    this.ctx = ctx;
    this.broadcaster = broadcaster;
    this.states = new Map();
    this.stateFile = path.join(ctx.dataDir, "sync-states.json");
  }

  loadStates(vaults) {
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));

      for (const entry of saved) {
        const vaultPath = vaults[entry.vaultId];

        if (!vaultPath) {
          this.ctx.log(`Skipping state for missing vault: ${entry.vaultId}`);
          continue;
        }

        this.states.set(entry.vaultId, {
          vaultId: entry.vaultId,
          vaultPath,
          remoteVault: entry.remoteVault,
          remoteVaultName: entry.remoteVaultName || null,
          status: "stopped",
          pid: null,
          lastActivity: new Date().toISOString(),
          error: null,
          config: entry.config || {
            mode: "bidirectional",
            deviceName: "ignis-headless",
          },
          autoStart: entry.autoStart || false,
          logs: [],
          _process: null,
        });
      }

      this.ctx.log(`Loaded ${saved.length} sync configurations`);
    } catch {
      this.ctx.log("No previous sync states found");
    }
  }

  saveStates() {
    const data = [];

    for (const [vaultId, state] of this.states) {
      data.push({
        vaultId: state.vaultId,
        vaultPath: state.vaultPath,
        remoteVault: state.remoteVault,
        remoteVaultName: state.remoteVaultName,
        config: state.config,
        autoStart: state.autoStart,
      });
    }

    fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2), "utf-8");
  }

  async setupSync(vaultId, vaultPath, remoteVault, options = {}) {
    const args = ["sync-setup", "--vault", remoteVault, "--path", "."];

    if (options.vaultPassword) {
      args.push("--password", options.vaultPassword);
    }

    if (options.deviceName) {
      args.push("--device-name", options.deviceName);
    }

    await runCommand(args, { cwd: vaultPath });

    const state = {
      vaultId,
      vaultPath,
      remoteVault,
      remoteVaultName: options.remoteVaultName || null,
      status: "stopped",
      pid: null,
      lastActivity: new Date().toISOString(),
      error: null,
      config: {
        mode: options.mode || "bidirectional",
        deviceName: options.deviceName || "ignis-headless",
      },
      autoStart: false,
      logs: [],
      _process: null,
    };

    this.states.set(vaultId, state);
    this.saveStates();
    this.ctx.log(`Sync setup complete for ${vaultId} -> ${remoteVault}`);

    return this.getState(vaultId);
  }

  startSync(vaultId) {
    const state = this.states.get(vaultId);

    if (!state) {
      throw new Error(`No sync configuration for vault: ${vaultId}`);
    }

    if (state.status === "running") {
      this.ctx.log(`Sync already running for ${vaultId}`);
      return this.getState(vaultId);
    }

    const args = ["sync", "--continuous"];

    if (state.config.mode === "pull-only") {
      args.push("--pull-only");
    } else if (state.config.mode === "mirror-remote") {
      args.push("--mirror-remote");
    }

    const proc = spawnOb(args, { cwd: state.vaultPath });

    state.status = "running";
    state.pid = proc.pid;
    state.error = null;
    state.autoStart = true;
    state._process = proc;

    this.addLog(state, `Sync started (pid: ${proc.pid})`);

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");

      for (const line of lines) {
        if (line.trim()) {
          this.addLog(state, line.trim());
          state.lastActivity = new Date().toISOString();
          this.broadcaster.broadcastLog(vaultId, line.trim());
        }
      }
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n");

      for (const line of lines) {
        if (line.trim()) {
          this.addLog(state, `[stderr] ${line.trim()}`);
        }
      }
    });

    proc.on("close", (code) => {
      // If the user explicitly stopped sync, don't overwrite the clean
      // "stopped" state with an error from the non-zero exit code.
      if (state._userStopped) {
        state._userStopped = false;
        return;
      }

      state.status = code === 0 ? "stopped" : "error";
      state.pid = null;
      state._process = null;

      if (code !== 0) {
        state.error = `Process exited with code ${code}`;
        this.addLog(state, `Sync exited with code ${code}`);
      } else {
        this.addLog(state, "Sync stopped");
      }

      this.ctx.log(`Sync stopped for ${vaultId} (code: ${code})`);
      this.broadcaster.broadcastStatus(this.getState(vaultId));
      this.saveStates();
    });

    proc.on("error", (err) => {
      state.status = "error";
      state.error = err.message;
      state.pid = null;
      state._process = null;

      this.addLog(state, `Error: ${err.message}`);
      this.ctx.log(`Sync error for ${vaultId}: ${err.message}`);
      this.broadcaster.broadcastStatus(this.getState(vaultId));
      this.saveStates();
    });

    this.broadcaster.broadcastStatus(this.getState(vaultId));
    this.ctx.log(`Started sync for ${vaultId} (pid: ${proc.pid})`);
    this.saveStates();

    return this.getState(vaultId);
  }

  stopSync(vaultId) {
    const state = this.states.get(vaultId);

    if (!state || !state._process) {
      throw new Error(`No active sync for vault: ${vaultId}`);
    }

    state._userStopped = true;
    killProcess(state._process);
    state.status = "stopped";
    state.pid = null;
    state.autoStart = false;
    state._process = null;

    this.addLog(state, "Sync stopped by user");
    this.ctx.log(`Stopped sync for ${vaultId}`);
    this.broadcaster.broadcastStatus(this.getState(vaultId));
    this.saveStates();

    return this.getState(vaultId);
  }

  async unlinkVault(vaultId) {
    const state = this.states.get(vaultId);

    if (!state) {
      throw new Error(`No sync configuration for vault: ${vaultId}`);
    }

    if (state._process) {
      state._userStopped = true;
      killProcess(state._process);
    }

    // Tell ob to disconnect from the remote vault and clear its stored config
    try {
      await runCommand(["sync-unlink", "--path", state.vaultPath]);
      this.ctx.log(`ob sync-unlink completed for ${vaultId}`);
    } catch (e) {
      this.ctx.log(`ob sync-unlink failed for ${vaultId}: ${e.message}`);
    }

    this.states.delete(vaultId);
    this.saveStates();
    this.ctx.log(`Unlinked vault ${vaultId}`);
  }

  getState(vaultId) {
    const state = this.states.get(vaultId);

    if (!state) {
      return null;
    }

    return {
      vaultId: state.vaultId,
      remoteVault: state.remoteVault,
      remoteVaultName: state.remoteVaultName,
      status: state.status,
      pid: state.pid,
      lastActivity: state.lastActivity,
      error: state.error,
      config: state.config,
      autoStart: state.autoStart,
    };
  }

  getAllStates() {
    const result = [];

    for (const [vaultId] of this.states) {
      result.push(this.getState(vaultId));
    }

    return result;
  }

  getLogs(vaultId, limit = 100) {
    const state = this.states.get(vaultId);

    if (!state) {
      return [];
    }

    return state.logs.slice(-limit);
  }

  addLog(state, line) {
    state.logs.push({
      timestamp: new Date().toISOString(),
      line,
    });

    if (state.logs.length > MAX_LOG_ENTRIES) {
      state.logs = state.logs.slice(-MAX_LOG_ENTRIES);
    }
  }

  autoStartAll() {
    let started = 0;

    for (const [vaultId, state] of this.states) {
      if (state.autoStart && state.status === "stopped") {
        try {
          this.startSync(vaultId);
          started++;
        } catch (e) {
          this.ctx.log(`Auto-start failed for ${vaultId}: ${e.message}`);
        }
      }
    }

    if (started > 0) {
      this.ctx.log(`Auto-started sync for ${started} vault(s)`);
    }
  }

  async shutdown() {
    this.ctx.log("Shutting down sync manager...");

    const waitPromises = [];

    for (const [vaultId, state] of this.states) {
      if (state._process) {
        this.ctx.log(`Stopping sync for ${vaultId}...`);
        state._userStopped = true;

        const proc = state._process;

        waitPromises.push(
          new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            proc.on("close", () => {
              clearTimeout(timeout);
              resolve();
            });
          }),
        );

        try {
          killProcess(proc);
        } catch (e) {
          this.ctx.log(`Error stopping sync for ${vaultId}: ${e.message}`);
        }
      }
    }

    if (waitPromises.length > 0) {
      await Promise.all(waitPromises);
    }

    this.saveStates();
  }
}

module.exports = { SyncManager };
