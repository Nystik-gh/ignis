const path = require("path");
const fs = require("fs");
const { toVaultRel } = require("@ignis/server-core");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// VAULT_ROOT: a directory that contains vault folders.
// Each subdirectory is a vault. New vaults are created as new subdirs.
const vaultRoot = process.env.VAULT_ROOT || path.join(REPO_ROOT, "vaults");

const dataRoot = process.env.DATA_ROOT || path.join(REPO_ROOT, "data");

// Ensure required directories exist
try {
  fs.mkdirSync(vaultRoot, { recursive: true });
} catch (e) {
  console.error("[config] Failed to create VAULT_ROOT:", vaultRoot, e.message);
}

try {
  fs.mkdirSync(dataRoot, { recursive: true });
} catch (e) {
  console.error("[config] Failed to create DATA_ROOT:", dataRoot, e.message);
}

function discoverVaults() {
  // clean object. TODO: refactor to Map for more idiomatic code.
  const vaults = Object.create(null);

  try {
    const entries = fs.readdirSync(vaultRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      let isDir = entry.isDirectory();

      // A symlink Dirent reports the link's type, not the target's, so follow it to find symlinked vaults.
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(path.join(vaultRoot, entry.name)).isDirectory();
        } catch (e) {
          console.error(
            "[config] Skipping unreadable vault entry:",
            entry.name,
            e.message,
          );
        }
      }

      if (isDir) {
        vaults[entry.name] = path.join(vaultRoot, entry.name);
      }
    }
  } catch (e) {
    console.error("[config] Failed to read VAULT_ROOT:", vaultRoot, e.message);
  }

  // Optionally create a default vault if none exist
  if (
    Object.keys(vaults).length === 0 &&
    process.env.AUTO_CREATE_DEFAULT === "true"
  ) {
    const defaultPath = path.join(vaultRoot, "My Vault");

    try {
      fs.mkdirSync(path.join(defaultPath, ".obsidian"), { recursive: true });
      vaults["My Vault"] = defaultPath;

      console.log("[config] Created default vault: My Vault");
    } catch (e) {
      console.error("[config] Failed to create default vault:", e.message);
    }
  }
  return vaults;
}

let vaults = discoverVaults();

const RESCAN_MIN_INTERVAL_MS = 1000;
let lastRescanAt = 0;

function getVaultPath(id) {
  return Object.prototype.hasOwnProperty.call(vaults, id) ? vaults[id] : null;
}

module.exports = {
  port: process.env.PORT || 8080,
  vaultRoot,
  dataRoot,
  get vaults() {
    return vaults;
  },
  get defaultVaultId() {
    return Object.keys(vaults)[0] || null;
  },
  getVaultPath,
  getVaultPathOrRescan(id, now = Date.now()) {
    const known = getVaultPath(id);

    if (known || !id || now - lastRescanAt < RESCAN_MIN_INTERVAL_MS) {
      return known;
    }

    lastRescanAt = now;
    vaults = discoverVaults();

    return getVaultPath(id);
  },
  // { vaultId, relPath } or null
  vaultForPath(absPath) {
    const target = path.resolve(absPath);

    for (const [vaultId, vaultPath] of Object.entries(vaults)) {
      const base = path.resolve(vaultPath);

      if (target === base || target.startsWith(base + path.sep)) {
        return {
          vaultId,
          relPath: toVaultRel(path.relative(base, target)),
        };
      }
    }

    return null;
  },
  refreshVaults() {
    vaults = discoverVaults();
    return vaults;
  },

  // 0 = disabled
  headlessSyncIdleRestartMs:
    parseInt(process.env.HEADLESS_SYNC_IDLE_RESTART_MS) || 0,

  devSuppressWriteFailures: process.env.DEV_SUPPRESS_WRITE_FAILURES === "true",
  devForceReadingView: process.env.DEV_FORCE_READING_VIEW === "true",

  obsidianAssetsPath:
    process.env.OBSIDIAN_ASSETS_PATH ||
    path.join(REPO_ROOT, "investigation", "obsidian_1.13.7_unpacked"),

  obsidianTermsOverride: process.env.OBSIDIAN_TERMS_STRING || "",

  get obsidianVersion() {
    // Read from the same path the assets are served from, so the version matches what ships.
    const assetsPath = this.obsidianAssetsPath;
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(assetsPath, "package.json"), "utf-8"),
      );
      return pkg.version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  },
};
