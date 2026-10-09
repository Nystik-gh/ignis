const { PluginSettingTab, Notice } = require("obsidian");
const api = require("./api");

class GitBackupSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this._shownState = null;
  }

  updateIfChanged() {
    const shownState = JSON.stringify([
      this.plugin.serverStatus,
      this.plugin.serverError,
    ]);

    if (shownState !== this._shownState) {
      this._shownState = shownState;
      this.update();
    }
  }

  getSettingDefinitions() {
    const { serverStatus, serverError } = this.plugin;
    const definitions = [
      {
        name: "Automatic vault backups",
        desc: "Git snapshots run on the server even with no browser tab open. History is stored in Ignis's data directory. Files ignored by .gitignore and Obsidian workspace layouts are excluded.",
        render: () => {},
      },
    ];

    if (serverError || !serverStatus?.installed) {
      definitions.push({
        name: "Backup status",
        desc: serverError
          ? `Failed to load backup status: ${serverError}`
          : serverStatus
            ? "Backup engine is unavailable on the server."
            : "Loading...",
        render: (setting) => {
          setting.addButton((btn) => {
            btn
              .setButtonText("Refresh")
              .onClick(() => this.plugin.loadStatus());
          });
        },
      });
      return [{ type: "group", items: definitions }];
    }

    const state = serverStatus.state;

    if (!state) {
      definitions.push({
        name: "Backup status",
        desc: "Backup is starting...",
        render: () => {},
      });
      return [{ type: "group", items: definitions }];
    }

    definitions.push(
      {
        name: "Backup interval",
        desc: "Check for changes every 10–3600 seconds. Changes between snapshots can only be recovered once a backup captures them.",
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            const intervals = new Set([
              10,
              30,
              60,
              300,
              900,
              3600,
              state.intervalSeconds,
            ]);

            for (const seconds of [...intervals].sort((a, b) => a - b)) {
              dropdown.addOption(String(seconds), `${seconds} seconds`);
            }

            dropdown
              .setValue(String(state.intervalSeconds))
              .onChange(async (value) => {
                try {
                  await api.setConfig(this.app.vault.getName(), Number(value));
                  new Notice("Backup settings saved");
                } catch (e) {
                  new Notice(`Failed to save backup settings: ${e.message}`);
                }

                await this.plugin.loadStatus();
              });
          });
        },
      },
      {
        name: "Backup status",
        desc:
          state.status === "error"
            ? `Last backup failed (${state.error}). Check the server log for details.`
            : state.status === "running"
              ? "Creating a snapshot..."
              : "Automatic backups are active",
        render: (setting) => {
          setting.addButton((btn) => {
            btn
              .setButtonText("Back up now")
              .setDisabled(state.status === "running")
              .onClick(() => this.plugin.backupNow());
          });
        },
      },
      {
        name: "Latest snapshot",
        desc: state.lastCommit
          ? `${new Date(state.lastCommitAt).toLocaleString()} · ${state.lastCommit.slice(0, 8)}`
          : "No content has been backed up yet",
        render: () => {},
      },
    );

    return [{ type: "group", items: definitions }];
  }
}

module.exports = { GitBackupSettingTab };
