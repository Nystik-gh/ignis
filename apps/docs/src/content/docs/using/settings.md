---
title: Settings
description: "Runtime configurable server settings"
---

Ignis adds its own tab to Obsidian's settings, where you configure the running server, as well as see the current ignis version and server status. Some settings only take effect after you reload the page.

## Caching

**Content cache** (default 50 MB) keeps file content in memory so reopening a file does not re-fetch it from the server. Increase it for a large vault or slow storage; lower it to use less memory.

**Input cache** (default 200 MB) holds files you pick in certain file dialogs, such as when using the Importer plugin. **Input cache TTL** (default 5 minutes) is how long a picked file stays available before it is dropped.

Cache changes take effect after a reload.

## Security

**Max request body** (default 50 MB) caps the largest request the server accepts.

**Proxy access** sets which external hosts a plugin may reach through the server's CORS proxy:

- **Any public host** (the default) reaches any public address.
- **Allowlist only** reaches just the hostnames you list. Restricting the proxy stops Obsidian's plugin and theme browser and its updates from working unless you allow their hosts, so the allowlist editor has a one-click button for the recommended set (`releases.obsidian.md`, `github.com`, `api.github.com`, `raw.githubusercontent.com`).
- **Disabled** turns off proxying entirely.

See [Hardening](/docs/security/hardening/) for what the proxy exposes and why you would narrow it.

**Direct-fetch hosts** are fetched by the browser directly, bypassing the proxy, and work only for hosts that allow cross-origin browser requests. This applies after a reload.

## Advanced

**Write coalesce window** (default 0, off) debounces rapid writes on slow filesystems such as rclone, NFS, or SMB. The same setting is available as the [`WRITE_COALESCE_MS`](/docs/server/environment/) environment variable.
