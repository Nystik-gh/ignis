const express = require("express");
const fs = require("fs");
const config = require("../config");
const path = require("path");
const bootstrapCache = require("../cache");
const settings = require("../settings");
const treeReconcile = require("../cache/reconcile");
const { withWatcherStopped } = require("../vault/lifecycle");
const { sanitizeError } = require("@ignis/server-core");

const router = express.Router();

// Vault management (list/info/refresh/create/rename/remove) has no user-level auth yet, so
// restrict it to requests originating from this machine. This keeps the endpoints from being
// reachable by any other host on the network while remaining usable for local clients/tests.
function isLoopback(req) {
  const ip = req.socket?.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

router.use((req, res, next) => {
  if (!isLoopback(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
});

// Vault names become directories under VAULT_ROOT; reject traversal, hidden, and reserved-device names.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// skip a refresh shortly after the last refresh
const REFRESH_COOLDOWN_MS = 10 * 1000;

// vaultId -> time of the last manual refresh
const lastRefreshAt = new Map();

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

// Resolve a validated vault name to a path guaranteed to stay inside VAULT_ROOT.
function resolveNewVaultPath(name) {
  const root = path.resolve(config.vaultRoot);
  const resolved = path.resolve(root, name);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }

  return resolved;
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

  res.json(bootstrapCache.buildVaultInfo(vaultId, vaultPath));
});

// POST /api/vault/refresh { vault } - reconcile the whole vault against disk, including ignored paths
router.post("/refresh", async (req, res) => {
  const vault = req.body?.vault;

  if (!config.getVaultPath(vault)) {
    return res.status(404).json({ error: "Vault not found" });
  }

  if (Date.now() - (lastRefreshAt.get(vault) || 0) < REFRESH_COOLDOWN_MS) {
    return res
      .status(429)
      .json({ error: "Vault was refreshed a moment ago, try again shortly" });
  }

  lastRefreshAt.set(vault, Date.now());

  try {
    const result = await bootstrapCache.reconcileVault(vault, {
      includeIgnored: true,
    });

    if (!result) {
      return res.json({ ok: true, reconciled: false, drifted: false });
    }

    res.json({ ok: true, reconciled: true, drifted: result.drifted });
  } catch (e) {
    res.status(500).json(sanitizeError(e));
  }
});

// POST /api/vault/create { name } - create a new vault in VAULT_ROOT
router.post("/create", async (req, res) => {
  const name = req.body?.name;

  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name" });
  }

  const vaultPath = resolveNewVaultPath(name);

  if (!vaultPath) {
    return res.status(400).json({ error: "Invalid vault name" });
  }

  try {
    await fs.promises.mkdir(vaultPath, { recursive: false });
    await fs.promises.mkdir(path.join(vaultPath, ".obsidian"), {
      recursive: false,
    });

    config.refreshVaults();
    bootstrapCache.invalidateVault(name);

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

    const trustedVaults = settings.get("trustedVaults");

    if (trustedVaults.includes(vaultId)) {
      settings.update({
        trustedVaults: trustedVaults.map((id) =>
          id === vaultId ? newName : id,
        ),
      });
    }

    treeReconcile.cancelVault(vaultId);
    bootstrapCache.invalidateVault(vaultId);
    bootstrapCache.invalidateVault(newName);

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

    const trustedVaults = settings.get("trustedVaults");

    if (trustedVaults.includes(vaultId)) {
      settings.update({
        trustedVaults: trustedVaults.filter((id) => id !== vaultId),
      });
    }

    treeReconcile.cancelVault(vaultId);
    bootstrapCache.invalidateVault(vaultId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json(sanitizeError(e));
  }
});

module.exports = router;
