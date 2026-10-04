---
title: Environment variables
description: Every variable the server reads, with its default.
---

Configure the server through environment variables, set in the `environment:` block of your compose file. For runtime configurable values see [Settings](/docs/using/settings/).

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on. |
| `VAULT_ROOT` | `/vaults` | Directory holding your vaults, one sub-folder per vault. |
| `DATA_ROOT` | `/app/data` | Directory for Ignis state: server plugin config, sync state, and tokens. |

## Obsidian

| Variable | Default | Description |
| --- | --- | --- |
| `OBSIDIAN_VERSION` | unset | Run a different Obsidian version than the version pinned by Ignis. Only newer versions are allowed, with no guarantee that Ignis works with them. |
| `OBSIDIAN_PACKAGE` | unset | Path to a pre-placed Obsidian package (`.deb`, `.asar.gz`, or `.asar`) to unpack instead of downloading, for offline installs. The package must be the version pinned by Ignis or newer. |
| `OBSIDIAN_ASSETS_PATH` | `/app/obsidian-app` | Where the extracted Obsidian files live. Point it at a pre-extracted directory to skip the download. |

## File ownership

| Variable | Default | Description |
| --- | --- | --- |
| `PUID` | `1000` | User ID that owns the files Ignis writes. |
| `PGID` | `1000` | Group ID that owns the files Ignis writes. |

## Networking and security

| Variable | Default | Description |
| --- | --- | --- |
| `WS_ORIGINS` | unset | Comma-separated allowlist of `Origin` values (with scheme) matched exactly against the browser's request. Any origin is accepted when unset. |
| `PROXY_ALLOW_PRIVATE_HOSTS` | unset | Comma-separated IPs or IPv4 CIDRs the cross-origin proxy may reach despite its private-address block. When unset, the proxy reaches no private host. Reopens SSRF to the listed targets. |

For example:

```yaml
    environment:
      - WS_ORIGINS=https://ignis.example.com
      - PROXY_ALLOW_PRIVATE_HOSTS=192.168.1.10,10.0.0.0/24
```

## Startup and performance

| Variable | Default | Description |
| --- | --- | --- |
| `AUTO_CREATE_DEFAULT` | `false` | Create a "My Vault" vault on startup when none exist. |
| `WRITE_COALESCE_MS` | `0` | Debounce window in milliseconds for rapid writes. Raise it on slow filesystems such as rclone, NFS, or SMB. Max 60000. |
| `UV_THREADPOOL_SIZE` | `4` | Node variable controlling how many file operations Ignis can run concurrently. Raising it helps with large vaults on network filesystems. |
| `IGNORED_PATHS` | none | Comma-separated gitignore patterns Ignis does not watch or track, added to the rule sets from Settings. See [Performance](/docs/performance/#ignored-paths). |

## Headless Sync

Applies to the [Headless Sync](/docs/using/server-plugins/) server plugin.

| Variable | Default | Description |
| --- | --- | --- |
| `HEADLESS_SYNC_IDLE_RESTART_MS` | `0` | Precautionary idle check. Since there is no output difference between an idle and a frozen sync process, this timeout can be used to force regular restarts of the sync process. Disabled when set to `0`. |

## Dev flags

Experimental switches that may change or disappear in later releases. They exist for vaults mounted read-only at the filesystem level (a `:ro` volume); Ignis does not enforce write protection itself. See [Read-only vaults](/docs/server/deploy/#read-only-vaults).

| Variable | Default | Description |
| --- | --- | --- |
| `DEV_SUPPRESS_WRITE_FAILURES` | `false` | Hide the notices Ignis shows when a save fails. Writes are still attempted and still fail. |
| `DEV_FORCE_READING_VIEW` | `false` | Open every note in reading view and prevent changing the view mode. |
