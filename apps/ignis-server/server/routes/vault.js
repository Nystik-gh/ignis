const express = require("express");
const fs = require("fs");
const config = require("../config");
const path = require("path");
const bootstrapRoutes = require("./bootstrap");
const {
  withWatcherStopped,
  broadcastVaultRefresh,
} = require("../vault-lifecycle");
const { sanitizeError } = require("@ignis/server-core");
const settings = require("../settings");

const router = express.Router();
const REFRESH_COOLDOWN_MS = 10000;
const refreshInFlight = new Map();
const refreshLastSuccess = new Map();

// Vault names become directories under VAULT_ROOT; reject traversal, hidden, and reserved-device names.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function isValidVaultName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) {
    return false;
  }

  if (/[/\\:*?"<>|]/.test(name)) {
    return false;
  }

  if (name.startsWith(".")) {
    return false;
  }

  return !WINDOWS_RESERVED.test(name);
}

function isAllowedOrigin(origin) {
  const allowed = settings.get("wsOrigins");

  if (!Array.isArray(allowed) || allowed.length === 0) {
    return true;
  }

  return typeof origin === "string" && allowed.includes(origin);
}

// GET /api/vault/list - returns all discovered vaults (re-scans on each call)
router.get("/list", (req, res) => {
  config.refreshVaults();

  const list = Object.entries(config.vaults).map(([id, vaultPath]) => ({
    id,
    name: id,
    path: vaultPath,
  }));

  res.json(list);
});

// GET /api/vault/info?vault=<id> - returns info for a specific vault
router.get("/info", async (req, res) => {
  const vaultId = req.query.vault || config.defaultVaultId;
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return res.status(404).json({ error: "Vault not found", id: vaultId });
  }

  res.json({
    id: vaultId,
    name: vaultId,
    path: vaultPath,
    platform: process.platform,
    version: config.obsidianVersion,
  });
});

// POST /api/vault/refresh { vault } - force rebuild the server tree cache from disk
router.post("/refresh", async (req, res) => {
  const origin = req.headers.origin;

  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const vaultId = req.body?.vault || config.defaultVaultId;
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return res.status(404).json({ error: "Vault not found", id: vaultId });
  }

  if (refreshInFlight.has(vaultId)) {
    return res.status(409).json({ error: "Vault refresh already running" });
  }

  const now = Date.now();
  const lastSuccess = refreshLastSuccess.get(vaultId) || 0;
  const retryAfterMs = REFRESH_COOLDOWN_MS - (now - lastSuccess);

  if (retryAfterMs > 0) {
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
    return res.status(429).json({
      error: "Vault refresh cooldown active",
      retryAfterMs,
    });
  }

  const startedAt = Date.now();
  const refresh = bootstrapRoutes.refreshVaultFromDisk(vaultId);

  refreshInFlight.set(vaultId, refresh);

  try {
    const result = await refresh;

    if (!result) {
      return res.status(404).json({ error: "Vault not found", id: vaultId });
    }

    const elapsedMs = Date.now() - startedAt;
    refreshLastSuccess.set(vaultId, Date.now());
    broadcastVaultRefresh(vaultId, result.treeRevision);
    console.log(
      `[vault] refresh vault=${vaultId} files=${result.files} dirs=${result.directories} time=${elapsedMs}ms`,
    );

    res.json({
      vault: vaultId,
      treeRevision: result.treeRevision,
      files: result.files,
      directories: result.directories,
      elapsedMs,
    });
  } catch (e) {
    res.status(500).json(sanitizeError(e));
  } finally {
    refreshInFlight.delete(vaultId);
  }
});

// POST /api/vault/create { name } - create a new vault in VAULT_ROOT
router.post("/create", async (req, res) => {
  const name = req.body?.name;

  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name" });
  }

  const vaultPath = path.join(config.vaultRoot, name);

  try {
    await fs.promises.mkdir(vaultPath, { recursive: false });
    await fs.promises.mkdir(path.join(vaultPath, ".obsidian"), {
      recursive: false,
    });

    config.refreshVaults();
    bootstrapRoutes.invalidateVault(name);

    res.json({ ok: true, id: name, path: vaultPath });
  } catch (e) {
    if (e.code === "EEXIST") {
      return res.status(409).json({ error: "Vault already exists" });
    }

    res.status(500).json(sanitizeError(e));
  }
});

// POST /api/vault/rename { vault, name } - rename a vault
router.post("/rename", async (req, res) => {
  const vaultId = req.body?.vault;
  const newName = req.body?.name;

  if (!isValidVaultName(newName)) {
    return res.status(400).json({ error: "Invalid vault name" });
  }

  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return res.status(404).json({ error: "Vault not found" });
  }

  if (
    newName !== vaultId &&
    Object.prototype.hasOwnProperty.call(config.vaults, newName)
  ) {
    return res
      .status(409)
      .json({ error: `A vault with name: ${newName} already exists` });
  }

  const newPath = path.join(config.vaultRoot, newName);

  try {
    await withWatcherStopped(vaultId, vaultPath, () =>
      fs.promises.rename(vaultPath, newPath),
    );

    config.refreshVaults();
    bootstrapRoutes.invalidateVault(vaultId);
    bootstrapRoutes.invalidateVault(newName);

    res.json({ ok: true, id: newName, path: newPath });
  } catch (e) {
    if (e.code === "ENOTEMPTY" || e.code === "EEXIST") {
      return res
        .status(409)
        .json({ error: `A vault with name: ${newName} already exists` });
    }

    res.status(500).json(sanitizeError(e));
  }
});

// DELETE /api/vault/remove?vault=<id> - remove a vault from disk
router.delete("/remove", async (req, res) => {
  const vaultId = req.query.vault;
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return res.status(404).json({ error: "Vault not found" });
  }

  try {
    await withWatcherStopped(vaultId, vaultPath, () =>
      fs.promises.rm(vaultPath, { recursive: true, force: true }),
    );

    config.refreshVaults();
    bootstrapRoutes.invalidateVault(vaultId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json(sanitizeError(e));
  }
});

module.exports = router;
module.exports._resetRefreshState = function () {
  refreshInFlight.clear();
  refreshLastSuccess.clear();
};
