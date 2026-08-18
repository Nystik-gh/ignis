const express = require("express");
const fs = require("fs");
const config = require("../config");
const path = require("path");
const bootstrapRoutes = require("./bootstrap");
const { withWatcherStopped } = require("../vault-lifecycle");
const { sanitizeError } = require("@ignis/server-core");

const router = express.Router();

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
