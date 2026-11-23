---
title: Settings
description: "Runtime configurable server settings"
---

Ignis adds its own tabs to Obsidian's settings for configuring the server and Ignis-specific functionality.

## General

The General tab configures server-wide settings that affect performance and security for the whole Ignis instance. It also displays the current Ignis version and if there is a new version available, as well as server connection status.

### Caching

**Content cache** (default 50 MB) keeps file content in memory so reopening a file does not re-fetch it from the server. Increase it for a large vault or slow storage; lower it to use less memory.

**Input cache** (default 200 MB) holds files you pick in certain file dialogs, such as when using the Importer plugin. **Input cache TTL** (default 5 minutes) is how long a picked file stays available before it is dropped.

Cache changes take effect after a tab refresh.

### Security

**Max request body** (default 50 MB) caps the largest request the server accepts. A reverse proxy in front of Ignis needs a body limit about a third larger than this setting, to account for the base64 encoding of uploads.

**Proxy access** sets which external hosts a plugin may reach through the server's CORS proxy:

- **Any public host** (the default) reaches any public address.
- **Allowlist only** reaches just the hostnames you list. Restricting the proxy stops Obsidian's plugin and theme browser and its updates from working unless you allow their hosts, so the allowlist editor has a one-click button for the recommended set (`releases.obsidian.md`, `github.com`, `api.github.com`, `raw.githubusercontent.com`).
- **Disabled** turns off proxying entirely.

See [Hardening](/docs/security/hardening/) for what the proxy exposes and why you would narrow it.

**Direct-fetch hosts** are fetched by the browser directly, bypassing the proxy, and work only for hosts that allow cross-origin browser requests. This applies after a tab refresh.

### Advanced

**Write coalesce window** (default 0, off) debounces rapid writes on slow filesystems such as rclone, NFS, or SMB. Max 60000. The same setting is available as the [`WRITE_COALESCE_MS`](/docs/server/environment/) environment variable.

**Ignored paths** are paths the server does not watch or track for changes, using rules defined with gitignore patterns. When creating rule sets for path exclusion, ignis also provides suggestions for plugin paths it determines to be heavy on the file watcher. See [Performance](/docs/performance/#ignored-paths).

## Vault

Ignis settings that apply to only the current vault.

**Always trust plugins for this vault** enables community plugins for the current vault in every browser that opens it. This lets you connect to Ignis and open your vault from any device without needing to explicitly permit plugins every time you use a new client. Toggling this setting on bypasses Obsidian's trust prompt for everyone who opens the vault, only enable it on vaults whose plugins you control.

## Core plugins

Server plugins such as Headless Sync are enabled per vault from this tab. See [Server plugins](/docs/using/server-plugins/).
