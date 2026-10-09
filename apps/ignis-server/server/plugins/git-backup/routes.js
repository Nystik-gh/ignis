const { sanitizeError } = require("@ignis/server-core");
const { isValidInterval } = require("./backup-manager");

function mountRoutes(router, plugin) {
  router.use((req, res, next) => {
    const vaultId =
      req.method === "GET" ? req.query.vaultId : req.body?.vaultId;
    const ctx = plugin.getCtx();

    if (typeof vaultId !== "string" || !vaultId) {
      return res.status(400).json({ error: "vaultId is required" });
    }

    if (!ctx.config.getVaultPath(vaultId)) {
      return res.status(404).json({ error: "Vault not found" });
    }

    if (!ctx.getEnabledVaults().includes(vaultId)) {
      return res
        .status(403)
        .json({ error: "Git Backup is not enabled for this vault" });
    }

    req.backupVaultId = vaultId;
    next();
  });

  router.get("/status", (req, res) => {
    res.json({
      ...plugin.getGitStatus(),
      state: plugin.getBackupManager().getState(req.backupVaultId),
    });
  });

  router.post("/config", async (req, res) => {
    if (!isValidInterval(req.body.intervalSeconds)) {
      return res.status(400).json({
        error: "intervalSeconds must be an integer between 10 and 3600",
      });
    }

    try {
      const state = await plugin
        .getBackupManager()
        .configureVault(req.backupVaultId, req.body.intervalSeconds);
      res.json({ success: true, state });
    } catch (e) {
      res.status(500).json(sanitizeError(e));
    }
  });

  router.post("/backup", async (req, res) => {
    try {
      const result = await plugin.getBackupManager().backup(req.backupVaultId);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json(sanitizeError(e));
    }
  });
}

module.exports = { mountRoutes };
