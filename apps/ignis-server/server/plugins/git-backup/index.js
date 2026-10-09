const path = require("path");
const { GIT_DEPENDENCY } = require("./git");
const { BackupManager } = require("./backup-manager");
const { mountRoutes } = require("./routes");

module.exports = {
  id: "git-backup",
  name: "Git Backup",
  description: "Automatic server-side Git snapshots of vault content",
  version: "0.1.0",
  obsidianPlugin: path.join(__dirname, "obsidian"),
  dependencies: [GIT_DEPENDENCY],

  _ctx: null,
  _gitStatus: null,
  _backupManager: null,

  async register(ctx) {
    this._ctx = ctx;
    this._gitStatus = { installed: true, version: GIT_DEPENDENCY.version };
    this._backupManager = new BackupManager(ctx);
    ctx.log(`Backup engine available (${this._gitStatus.version})`);
    mountRoutes(ctx.router, this);
  },

  async onVaultEnabled(vaultId, vaultPath) {
    await this._backupManager.enableVault(vaultId, vaultPath);
  },

  async onVaultDisabled(vaultId) {
    await this._backupManager.disableVault(vaultId);
  },

  async shutdown() {
    await this._backupManager?.shutdown();
    this._backupManager = null;
    this._ctx = null;
  },

  getCtx() {
    return this._ctx;
  },

  getGitStatus() {
    return this._gitStatus;
  },

  getBackupManager() {
    return this._backupManager;
  },
};
