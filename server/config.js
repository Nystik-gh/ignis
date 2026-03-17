const path = require("path");
const fs = require("fs");

// VAULT_ROOT: a directory that contains vault folders.
// Each subdirectory is a vault. New vaults are created as new subdirs.
// Falls back to parent of VAULT_PATH (single-vault compatibility) or ./vaults.
const vaultRoot =
  process.env.VAULT_ROOT ||
  (process.env.VAULT_PATH
    ? path.dirname(process.env.VAULT_PATH)
    : path.join(__dirname, "..", "vaults"));

// Ensure vault root exists
try {
  fs.mkdirSync(vaultRoot, { recursive: true });
} catch (e) {
  console.error("[config] Failed to create VAULT_ROOT:", vaultRoot, e.message);
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

  // Create a default vault if none exist
  if (Object.keys(vaults).length === 0) {
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
  obsidianAssetsPath:
    process.env.OBSIDIAN_ASSETS_PATH ||
    path.join(__dirname, "..", "investigation", "obsidian_1.12.4_unpacked"),

  get obsidianVersion() {
    const assetsPath =
      process.env.OBSIDIAN_ASSETS_PATH ||
      path.join(__dirname, "..", "investigation", "obsidian_1.12.4_unpacked");
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
