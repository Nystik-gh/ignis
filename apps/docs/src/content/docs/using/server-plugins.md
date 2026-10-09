---
title: Server plugins
description: Ignis plugins that run on the server.
---

Server plugins are Ignis's own plugins that run on the server, separate from Obsidian's community plugins. You enable them per vault from the **Core plugins** tab under **Ignis** in Obsidian's settings.

Required components are installed on first enable, using npm as the server's normal user. Disabled plugins do not download anything. Exact package versions are cached under `DATA_ROOT/plugin-dependencies/` and shared between plugins and vaults. Keep that directory to reuse installations after a restart or container update. Installations use separate caches for each operating system, CPU architecture, Node.js ABI, and install script policy, so native components are not reused in an incompatible runtime.

The first installation needs network access and a writable data directory; later starts can use the completed cache offline. Failed installations leave the plugin disabled, and enabling it again retries. Disabling a plugin keeps its installed components and saved data. npm packages provide the automatic installation path; host packages such as apt packages are not installed by the plugin manager.

## Git Backup

Git Backup commits vault snapshots on the server, including changes received from sync. It keeps running with no browser tab open. Enable it for a vault in **Ignis → Core plugins**, then open **Git Backup** under **Ignis Core Plugins** to view its status, change the interval, or select **Back up now**. The command palette also has a **Git Backup: Back up vault now** command.

Enabling the plugin creates the first snapshot immediately. After that it checks every 60 seconds by default, with a configurable interval from 10 to 3600 seconds. Only changes create a commit; additions, edits, and deletions are recorded. A failed backup is shown in the settings tab and retried at the next interval. Disabling the plugin stops automatic commits and preserves existing history. Enabled vaults resume backups after a server restart.

Git Backup installs its pure JavaScript Git engine on demand and does not require a system Git executable. Each vault has a separate repository under `DATA_ROOT/plugins/git-backup/<key>/repository.git`, where `<key>` is the SHA-256 hash of the vault name. The adjacent `config.json` identifies the vault and stores its interval. With the default Docker setup, these files are in the host's `./data/plugins/git-backup/` directory. Keep the data directory outside your vaults and persist it along with your other Ignis state.

The plugin uses an independent Git index and the `Ignis <ignis@localhost>` identity. It leaves any existing vault Git repository and staged changes untouched. It follows the vault's `.gitignore` rules and excludes `.git`, `.obsidian/workspace.json`, and `.obsidian/workspace-mobile.json`. Other Obsidian settings and attachments are included unless ignored. File watcher ignore rules do not affect backups.

### Recovering a file

Use Git on your host or another machine with access to the data directory to recover files. Find the vault's key by reading its `config.json`. Replace `VAULT_KEY` with its directory name, then inspect the repository:

```sh
repository="data/plugins/git-backup/VAULT_KEY/repository.git"
git --git-dir="$repository" log --oneline
```

Export a file from a commit before the unwanted edit or deletion, replacing `COMMIT` with the commit hash:

```sh
git --git-dir="$repository" show "COMMIT:Notes/My note.md" > /tmp/recovered-note.md
```

Inspect the exported file, then copy it back into the vault when ready. These commands use paths relative to Ignis's working directory; adjust `data` to your actual `DATA_ROOT`. Recovery remains available if the vault is deleted or renamed because the repository is stored separately. A renamed vault needs the plugin enabled again under its new name and gets a separate history.

Snapshots capture files as Git reads them and can span an ongoing sync; they are not tied to sync completion. Changes made and lost entirely between snapshots cannot be recovered. History stays on this server, grows as content changes, and is not pushed to a remote. Back up both your vaults and `DATA_ROOT` separately to cover server or disk loss.

## Headless Sync

While Ignis supports the Obsidian Sync core plugin, that plugin can only run when Obsidian is loaded in a browser tab, so it stops syncing once you close the tab. Headless Sync runs the same Obsidian Sync on the server instead, through the `obsidian-headless` CLI, so a vault keeps syncing even without a browser tab open.

Enable it for a vault in the Ignis -> Core plugins tab, then sign in with your Obsidian Sync account and link the vault from its settings tab. Headless Sync will continuously sync your vault in the background, resuming on container restart.

Its `obsidian-headless` CLI is installed on demand into the same dependency cache, with no global npm installation. The sign-in relay can also prepare this CLI when it needs a fallback for an unavailable account service.

### Sync settings

Headless sync shares most settings with the official Sync plugin (it uses the official headless sync cli in the background). In the Settings tab, under "Ignis Core Plugins" heading; you can configure which remote vault to sync with, the sync mode, what types of files or settings you want to sync, manage excluded folders, and see the log from the sync process. For details on how these settings work, see the official Obsidian help for [Sync settings and selective syncing](https://obsidian.md/help/sync/settings) and for the [Headless Sync CLI](https://obsidian.md/help/sync/headless).
