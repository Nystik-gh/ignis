const { Plugin, Notice } = require("obsidian");
const { GitBackupSettingTab } = require("./settings-tab");
const api = require("./api");

class IgnisGitBackupPlugin extends Plugin {
  onload() {
    if (!window.__ignis) {
      return;
    }

    this.serverStatus = null;
    this.serverError = null;
    this._unloaded = false;
    this._settingTab = new GitBackupSettingTab(this.app, this);
    this.addSettingTab(this._settingTab);
    this.loadStatus();
    this.registerInterval(window.setInterval(() => this.loadStatus(), 10000));

    this.addCommand({
      id: "backup-now",
      name: "Back up vault now",
      callback: () => this.backupNow(),
    });
  }

  async loadStatus() {
    try {
      const status = await api.getStatus(this.app.vault.getName());

      if (this._unloaded) {
        return;
      }

      this.serverStatus = status;
      this.serverError = null;
    } catch (e) {
      if (this._unloaded) {
        return;
      }

      this.serverError = e.message;
    }

    this._settingTab.updateIfChanged();
  }

  async backupNow() {
    try {
      const { committed } = await api.backup(this.app.vault.getName());
      new Notice(
        committed ? "Vault backup committed" : "Vault backup is up to date",
      );
    } catch (e) {
      new Notice(`Backup failed: ${e.message}`);
    }

    await this.loadStatus();
  }

  onunload() {
    this._unloaded = true;
  }
}

module.exports = IgnisGitBackupPlugin;
