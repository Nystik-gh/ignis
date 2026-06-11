const path = require("path");
const fs = require("fs");

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
  const vaults = {};

  try {
    const entries = fs.readdirSync(vaultRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
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
  getVaultPath(id) {
    return vaults[id] || null;
  },
  refreshVaults() {
    vaults = discoverVaults();
    return vaults;
  },

  demoMode: process.env.DEMO_MODE === "true",
  demoMaxSessions: parseInt(process.env.DEMO_MAX_SESSIONS) || 20,
  demoVaultsPerSession: parseInt(process.env.DEMO_VAULTS_PER_SESSION) || 3,
  demoSessionQuotaBytes:
    parseInt(process.env.DEMO_SESSION_QUOTA_BYTES) || 700 * 1024,
  demoTimeoutMs: parseInt(process.env.DEMO_TIMEOUT_MS) || 30 * 60 * 1000,
  demoTemplateDir:
    process.env.DEMO_TEMPLATE_DIR || path.join(__dirname, "demo-template"),

  // Built-in authentication.
  authUser: process.env.IGNIS_AUTH_USER || null,
  authPass: process.env.IGNIS_AUTH_PASS || null,
  apiKey: process.env.IGNIS_API_KEY || null,
  get authEnabled() {
    return !!(this.authUser || this.apiKey);
  },
  authTimeoutMs: parseInt(process.env.IGNIS_AUTH_TIMEOUT_MS) || 24 * 60 * 60 * 1000,

  obsidianAssetsPath:
    process.env.OBSIDIAN_ASSETS_PATH ||
    path.join(REPO_ROOT, "investigation", "obsidian_1.12.7_unpacked"),

  get obsidianVersion() {
    const assetsPath =
      process.env.OBSIDIAN_ASSETS_PATH ||
      path.join(__dirname, "..", "investigation", "obsidian_1.12.7_unpacked");
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
