const express = require("express");
const {
  getDiscoveredPlugins,
  enablePluginForVault,
  disablePluginForVault,
} = require("../plugin-system/manager");
const { sanitizeError } = require("@ignis/server-core");
const bootstrapCache = require("../cache");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getDiscoveredPlugins());
});

router.post("/:pluginId/enable", async (req, res) => {
  const vaultId = req.body?.vault;

  if (!vaultId) {
    return res.status(400).json({ error: "Missing vault ID" });
  }

  try {
    await enablePluginForVault(req.params.pluginId, vaultId);
    bootstrapCache.invalidateVault(vaultId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(sanitizeError(e));
  }
});

router.post("/:pluginId/disable", async (req, res) => {
  const vaultId = req.body?.vault;

  if (!vaultId) {
    return res.status(400).json({ error: "Missing vault ID" });
  }

  try {
    await disablePluginForVault(req.params.pluginId, vaultId);
    bootstrapCache.invalidateVault(vaultId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(sanitizeError(e));
  }
});

module.exports = router;
