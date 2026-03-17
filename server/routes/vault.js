const express = require("express");
const fs = require("fs");
const config = require("../config");
const path = require("path");

const router = express.Router();

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
router.get("/info", (req, res) => {
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

  if (!name || /[\/\\:*?"<>|]/.test(name)) {
    return res.status(400).json({ error: "Invalid vault name" });
  }

  const vaultPath = path.join(config.vaultRoot, name);

  try {
    await fs.promises.mkdir(vaultPath, { recursive: false });
    await fs.promises.mkdir(path.join(vaultPath, ".obsidian"), {
      recursive: false,
    });

    config.refreshVaults();

    res.json({ ok: true, id: name, path: vaultPath });
  } catch (e) {
    if (e.code === "EEXIST") {
      return res.status(409).json({ error: "Vault already exists" });
    }

    res.status(500).json({ error: e.message, code: e.code });
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
    await fs.promises.rm(vaultPath, { recursive: true });

    config.refreshVaults();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

module.exports = router;
