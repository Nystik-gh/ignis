const path = require("path");
const obCli = require("../../obsidian-account/ob-cli");
const auth = require("./auth");
const { SyncManager } = require("./sync-manager");
const { SyncBroadcaster } = require("./broadcaster");

module.exports = {
  id: "headless-sync",
  name: "Headless Sync",
  description: "Server-side vault sync via obsidian-headless CLI",
  version: "0.3.0",
  //TODO: add server plugin manifest

  obsidianPlugin: path.join(__dirname, "obsidian"),
  dependencies: [obCli.HEADLESS_DEPENDENCY],

  _ctx: null,
  _obStatus: null,
  _syncManager: null,
  _broadcaster: null,

  async register(ctx) {
    this._ctx = ctx;
    obCli.useManagedCli(ctx.dependencies.resolve("obsidian-headless"));

    this._obStatus = obCli.checkInstalled();

    if (this._obStatus.installed) {
      ctx.log(`ob CLI available (${this._obStatus.version})`);
    } else {
      ctx.log("ob CLI not found. Install obsidian-headless to enable sync.");
    }

    const token = auth.loadToken(ctx.dataDir);

    if (token) {
      ctx.log("Auth token loaded");
    }

    this._broadcaster = new SyncBroadcaster(ctx.wss);
    this._syncManager = new SyncManager(ctx, this._broadcaster);

    // Load saved sync states for enabled vaults
    const enabledVaults = ctx.getEnabledVaults();
    const vaultMap = {};

    for (const vaultId of enabledVaults) {
      const vaultPath = ctx.config.getVaultPath(vaultId);

      if (vaultPath) {
        vaultMap[vaultId] = vaultPath;
      }
    }

    this._syncManager.loadStates(vaultMap);

    // Auto-start syncs that were running before shutdown
    if (this._obStatus.installed && auth.isAuthenticated(ctx.dataDir)) {
      await this._syncManager.applyPendingConfigs();
      this._syncManager.autoStartAll();
    }

    const { mountRoutes } = require("./routes");
    mountRoutes(ctx.router, this);
  },

  async shutdown() {
    if (this._syncManager) {
      await this._syncManager.shutdown();
      this._syncManager = null;
    }

    this._ctx = null;
  },

  async onVaultEnabled(vaultId, vaultPath) {
    if (this._ctx) {
      this._ctx.log(`Vault enabled: ${vaultId}`);
    }
  },

  async onVaultDisabled(vaultId, vaultPath) {
    if (!this._ctx) {
      return;
    }

    this._ctx.log(`Vault disabled: ${vaultId}`);

    // Stop sync if running, but keep the config
    if (this._syncManager) {
      const state = this._syncManager.getState(vaultId);

      if (state && state.status === "running") {
        this._syncManager.stopSync(vaultId);
      }
    }
  },

  getObStatus() {
    return this._obStatus;
  },

  getCtx() {
    return this._ctx;
  },

  getSyncManager() {
    return this._syncManager;
  },
};
