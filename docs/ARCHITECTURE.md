# Architecture

Ignis runs Obsidian in a browser by replacing its Electron backend with a shim layer that routes Node.js and Electron API calls to an Express server over HTTP and WebSocket.

## Contents

- [Overview](#overview)
- [Shim Layer](#shim-layer)
  - [Loading](#loading)
  - [Modules](#modules)
  - [Filesystem](#filesystem)
  - [Transforms](#transforms)
  - [IPC](#ipc)
  - [Cross-origin requests](#cross-origin-requests)
  - [Workspaces in browser tabs](#workspaces-in-browser-tabs)
- [Bridge](#bridge)
- [Vaults](#vaults)
- [Server](#server)
- [Plugins](#plugins)
  - [Obsidian Plugins](#obsidian-plugins)
  - [Ignis Plugins](#ignis-plugins)
  - [Virtual Plugins](#virtual-plugins)
- [Demo mode](#demo-mode)

## Overview

```
Browser                          Server
┌──────────────────────┐         ┌──────────────────────┐
│ Obsidian (unmodified)│         │ Express              │
│         ↕            │  HTTP   │   /api/fs/*          │
│ Shim layer           │ <────>  │   /api/vault/*       │
│   fs, electron, etc. │   WS    │   /api/plugins/*     │
│         ↕            │ <────>  │   /api/ext/:plugin/* │
│ Bridge               │         │ Ignis plugins        │
└──────────────────────┘         └──────────────────────┘
                                          ↕
                                    Filesystem (vaults/)
```

The shim layer makes Obsidian think it's running in Electron. The bridge adds Ignis-specific features inside Obsidian.

## Shim Layer

### Loading

The server serves its own `index.html` (in `apps/ignis-server/server/assets/`) rather than Obsidian's. At startup it reads Obsidian's `index.html` once to discover which scripts Obsidian expects, then embeds that list in our HTML as a JSON array. The client-side HTML loads the shim loader and UI bundle first (non-deferred), then a small inline script dynamically injects Obsidian's scripts in order. The injected asset URLs (`app.js`, `app.css`, `lib/*`) are versioned by the pinned Obsidian version and served immutable, so the browser and any CDN edge hold the bundle across loads instead of re-pulling it. Obsidian's files are never modified on disk, or transformed in transit.

Before injecting Obsidian's scripts, the shim loader sets `localStorage.EmulateMobile` based on viewport width (< 600px) so Obsidian boots into its mobile UI on phones and narrow windows. The loader replaces the module system, then issues a single blocking bootstrap request that returns the vault info, vault list, metadata tree, and Ignis plugin list in one pre-compressed response. The request has to be blocking because Obsidian makes synchronous filesystem calls during page load, before the event loop is running, so the cache has to already be populated.

Immediately after the bootstrap response is applied, the client prefetches file content into the ContentCache (`POST /api/fs/batch-read`), split into two slices. A priority slice (the `.obsidian` root configs plus each plugin's `main.js`, `manifest.json`, and `styles.css`) is awaited before Obsidian's scripts are injected, so Obsidian's synchronous boot reads hit the cache rather than the network. A bulk slice of the remaining text content streams afterward without blocking boot. The boot splash reflects prefetch progress.

### Modules

| Module               | Implementation                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `fs` / `original-fs` | HTTP transport + client-side metadata cache + 50MB LRU content cache. Full surface.             |
| `path`               | path-browserify                                                                                 |
| `url`                | Browser URL API wrapper                                                                         |
| `process`            | Platform/version stubs                                                                          |
| `crypto`             | `randomBytes`, `randomUUID`, `scrypt` use Web Crypto. `createHash` produces real digests for SHA-1/SHA-256/SHA-512/MD5 via `@noble/hashes`. Web Crypto needs a secure context; on plain HTTP at a non-localhost origin it is unavailable and the UI shows an insecure-context banner. |
| `electron`           | `ipcRenderer` dispatcher, `webFrame` stubs, `clipboard`, `nativeImage`, `safeStorage` (passthrough, reports unavailable). |
| `@electron/remote`   | Partial: `clipboard`, `shell`, `dialog` (with a sync file picker workaround), `Menu`, `BrowserWindow`, `nativeTheme`, `session`, `systemPreferences`, `screen`, `nativeImage`, `Notification`, `app`. |
| `zlib`               | Sync + callback variants via pako (`deflate`, `inflate`, `gzip`, `gunzip`, raw). Streaming classes (`createGzip` etc.) throw. |
| `os`                 | Identity stubs (`platform()` returns `"linux"`, `hostname()` returns `"localhost"`, etc.).      |
| `events`             | Standard EventEmitter implementation.                                                           |
| `util`               | Common helpers (`promisify`, `inherits`, type guards).                                          |
| `child_process`      | All functions throw "not available in the web version."                                         |
| `net`                | All classes/functions throw.                                                                    |
| `http` / `https`     | Module is importable but `request()`/`get()` emit an `error` event; `createServer` throws. Plugins should use `requestUrl` or `fetch` (the shim routes cross-origin `fetch` through the server proxy). |
| `buffer`             | Aliased to the browser `Buffer` polyfill set up by the loader.                                  |
| `assert`             | Standard assertions: `assert`, `equal`, `strictEqual`, `deepEqual`, `throws`. |
| `constants`          | File access and mode constants (`F_OK`, `O_RDONLY`, `S_IFMT`, etc.) for the reported Linux platform. |
| `stream`             | Base classes (`Stream`, `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`) extending EventEmitter. Data-flow methods warn and do nothing. |

Unknown modules return an empty proxy and log a warning. The `node:` prefix is stripped. The shim exposes two console helpers, `window.__shimLog()` (everything that has been accessed) and `window.__shimMisses()` (accessed-but-missing properties).

### Filesystem

Two caches on the client side. The **MetadataCache** holds `{ type, size, mtime, ctime }` for every entry, populated from the bootstrap response. Sync filesystem calls (`existsSync`, `statSync`, `readdirSync`) read from it and never hit the network. The **ContentCache** is a 50 MB LRU of file bytes, populated lazily on first read and warmed by the indexer pre-fetch on cold start. Both caches are kept current by WebSocket watcher events: writes from another tab or external changes on disk invalidate or update the relevant entries within a second.

Reads not satisfied by ContentCache go through the transport layer to `/api/fs/readFile`. Sync calls use synchronous XHR to keep Obsidian's pre-boot module code working. Async calls use fetch. The transport handles vault id injection, base64 encoding for binary files, and mapping HTTP error codes back to Node errno values (`ENOENT`, `EEXIST`, `ENOTDIR`).

Writes go through a server-side write coalescer (`packages/server-core/src/write-coalescer.js`) designed for slow filesystems like rclone FUSE mounts. The first write to a path goes to disk immediately. Subsequent writes within a configurable window (`WRITE_COALESCE_MS`, default `0` which disables coalescing) are buffered and flushed when the debounce timer fires; the timer resets on each write. Buffered writes return to the HTTP client immediately with synthetic metadata so connection-pool starvation on rapid-fire writes (e.g. `workspace.json` autosaves) doesn't stall unrelated reads. Reads for pending paths serve the buffered content so clients never see stale data. All pending writes are flushed on graceful shutdown.

A write that fails at the transport is queued per path and retried in the background with backoff, so a transient network or server error does not lose the write. A dirty-state store tracks which paths have writes still pending and which have exhausted their retries and failed. This state is exposed to other client components.

### Transforms

The shim has a transforms registry (`packages/shim/src/fs/transforms.js`) for hooks applied at the public shim surface, before caches or transport see the path. Three hook types:

- **Path resolvers** map a logical path to a physical path. Used by the workspaces shim to redirect reads and writes of `.obsidian/workspace.json` to `.obsidian/workspace.<name>.json` based on the `?workspace=` URL parameter, so each browser tab can hold a separate layout.
- **Read transforms** post-process bytes returned by a read (cache hit or transport miss). Used to mask the Obsidian Sync setting in `core-plugins.json` when headless-sync is active for the vault, and to override the `active` field on reads of `workspaces.json` so each tab sees its own workspace as selected.
- **Write transforms** pre-process bytes before a write hits the cache or transport. Used to override the `active` field on writes to `workspaces.json` so cross-tab disk state stays canonical.

All hooks are synchronous and registered at module load. They fire once at the shim entry; downstream layers (content cache, metadata cache, transport) operate only on resolved physical paths and as-stored bytes. This keeps cache keys coherent with what transport actually reads and writes, so prefetch and on-demand fetches share the same cache slot.

### IPC

Electron's `ipcRenderer` is the renderer's channel to the main process for things only that process can do: looking up the active vault, opening a new vault window, performing cross-origin requests, printing to PDF. Ignis has no main process, so the shim is an in-process router that returns values for sync calls and fires side effects for async ones.

Sync channels covered include `vault`, `version`, `vault-list`, `vault-open`, `vault-remove`, `file-url`, `starter`, and `help`. Each maps to a handler that returns immediately. Async channels: `request-url` is routed to the CORS proxy (or fetched directly when the host is on the direct-fetch allowlist), `print-to-pdf` triggers a hidden popup iframe, `context-menu` replies on the next tick. The standard `on`/`once`/`removeListener` interface works as it would in Electron.

### Cross-origin requests

Obsidian on the desktop can make arbitrary cross-origin HTTP requests because it runs as an Electron app rather than a sandboxed browser context. In a browser tab, the same requests would be blocked by CORS or rejected by the same-origin policy. Plugin installs from GitHub, theme asset downloads, calls to third-party APIs: all of it assumes cross-origin is available.

The shim handles this transparently. `window.fetch` and `window.requestUrl` are intercepted. Same-origin requests pass through unchanged, as do requests to hosts on the user-configured direct-fetch allowlist, which the browser fetches directly subject to its own CORS enforcement. All other cross-origin requests are POSTed to `/api/proxy`, which performs the outbound call from the server with headers that mimic Obsidian's desktop runtime: `Origin: app://obsidian.md` and the browser's own User-Agent. The response body is returned base64-encoded so binary content survives the JSON round-trip; the shim decodes it and hands the caller a normal `Response` or `requestUrl` result.

The proxy itself is intentionally generic. It forwards method, headers, and body verbatim and returns whatever the upstream sent. It always rejects requests whose hostname resolves to a private, loopback, or link-local address (SSRF guard). Outbound access is governed by `proxyMode`: `any` (the default) reaches any public host, `allowlist` restricts to a configured host list, and `disabled` blocks all proxying; demo mode pins it to `allowlist`. Under the default `any`, the proxy is an open relay to public hosts, which is one of the reasons the server needs to be behind authentication when exposed to the internet.

### Workspaces in browser tabs

Obsidian's Workspaces core plugin lets you save a window layout under a name. Ignis adds a `?workspace=<name>` URL parameter that binds a tab to a specific layout. The bridge plugin's "Open workspace in new tab" command opens the picked workspace in a fresh tab.

The implementation uses all three transforms (above): a path resolver redirects `.obsidian/workspace.json` to `.obsidian/workspace.<name>.json` so each tab has its own state file; a read transform overrides the `active` field on `workspaces.json` so the current tab's menu shows its own workspace as selected; a write transform keeps the canonical `active` value stable on disk so concurrent tabs don't clobber each other.

Two tabs in the same workspace share the same state file and stay in sync through the file watcher. Two tabs in different workspaces hold independent layout state.

## Bridge

Ignis's built-in integration with the Obsidian UI. It subclasses Obsidian's `Plugin` to get convenient hooks (commands, ribbon icons, status bar items, settings tabs, workspace events), but it is not a plugin in the managed sense: it isn't discovered, toggled, enabled per vault, or installed into `.obsidian/plugins/`. It's bundled into `shim-loader.js` (source in `packages/bridge/`), instantiated directly by the shim loader after Obsidian boots, and always on.

The bridge contributes:

- **File actions**: a ribbon icon for uploading files into the current folder, and right-click menu items: Download (single file), Download as ZIP (folder), and Upload file (folder).
- **Commands**: `Open workspace in new tab`.
- **Status bar item**: a dot showing the WebSocket connection state to the Ignis server.
- **Settings injection**: monkey-patches `app.setting.onOpen` to add two tabs in their own "Ignis" sidebar group. Each enabled Ignis plugin's companion is pulled into a separate "Ignis Core Plugins" sidebar group.
- **Demo guards**: in demo mode, a MutationObserver disables every email/password input that appears anywhere in the document.

## Vaults

Any subdirectory under the vault root is treated as a vault. The active vault is selected via a `?vault=` URL parameter. Without the queryparam, the last active vault is loaded (from `localStorage.last-vault`), or the first discovered.

## Server

An Express server that handles filesystem operations, vault management, static file serving, and plugin route dispatch.

**Route groups:**
- `/api/fs/*` - filesystem operations (read, write, stat, tree, mkdir, batch-read, download, download-zip, etc.).
- `/api/vault/*` - vault CRUD and config.
- `/api/bootstrap` - one-shot cold-start endpoint; returns vault info + list + metadata tree + plugin list as a single pre-compressed response, cached per vault with mtime-based invalidation.
- `/api/proxy` - cross-origin HTTP proxy used by the fetch and requestUrl shims.
- `/api/version` - Ignis version (SemVer), per-build identifier, and pinned Obsidian version.
- `/api/settings/*` - read and update runtime server settings (cache sizes, request body limit, write-coalesce window, proxy mode and allowlist, direct-fetch host allowlist).
- `/api/plugins/*` - Ignis plugin management (list, enable, disable). __WIP__
- `/api/ext/:pluginId/*` - routes registered by individual Ignis plugins.
- `/vault-files/<vaultId>/<path>` - static file serving rooted at a vault, used by Obsidian for image/attachment resource URLs.

**WebSocket:** A file watcher monitors vault directories and pushes change events to connected clients, keeping the client-side metadata and content caches in sync. An echo guard suppresses events caused by the same client's recent writes so they don't bounce back. A ping/pong heartbeat keeps connections alive through idle-timeout proxies and terminates any that stop responding; after a reconnect the client reconciles its metadata cache so file events missed while the socket was down are recovered. The watcher also carries plugin-defined message types (e.g. headless-sync status broadcasts).

**Legacy bridge cleanup:** Earlier versions installed the bridge into each vault's `.obsidian/plugins/`. The bridge is now bundled into the shim and loaded client-side, so on startup the server removes any leftover on-disk `ignis-bridge` install from each vault (and strips it from `community-plugins.json`).

## Plugins

Aside from the built-in [Bridge](#bridge), three kinds of plugin exist in Ignis, distinguished by who loads them and where they run.

### Obsidian Plugins

Standard community and core Obsidian plugins. Obsidian evals plugin code with its own require that checks its internal module map first, then falls back to the window-level require, which Ignis replaces with the shim. Plugins that use the filesystem, path utilities, or crypto get shim implementations transparently. Plugins that need child processes, raw sockets, or native addons load but throw on first use; the error message names the missing API.

### Ignis Plugins

A plugin system for extending the server. Still early, the core lifecycle works but the API surface is minimal and likely to change.

An Ignis plugin is a Node.js package under `apps/ignis-server/server/plugins/<name>/` that exports an id, name, and a `register` function. On load it receives a context object with access to config, the WebSocket server, a file watcher, an Express router, a logger, and a persistent data directory. Plugins are enabled and disabled per vault, with state persisted in `data/plugin-config.json`. When enabled, a plugin's Express router is mounted at `/api/ext/<pluginId>/`.

An Ignis plugin can optionally ship a **virtual plugin** (see below): an Obsidian-side companion that provides the in-app UI. The Ignis plugin handles server logic and routes; the virtual plugin runs in the browser.

The one Ignis plugin currently in the repo is **headless-sync** (`apps/ignis-server/server/plugins/headless-sync/`). It wraps the [obsidian-headless](https://github.com/obsidianmd/obsidian-headless) CLI (`ob`) and runs `ob sync --continuous` as a per-vault child process, optionally with `--pull-only` or `--mirror-remote`. Process state (running/stopped/error, pid, last activity, recent log lines) is broadcast to subscribed clients over a WebSocket channel.

### Virtual Plugins

The client-side companion of an Ignis plugin: a standard Obsidian plugin (a `manifest.json` plus a bundled script) that Ignis loads in the browser rather than installing to disk. The virtual-plugin-loader (`packages/shim/src/virtual-plugin-loader.js`) fetches the bundle from the server, evals it, instantiates the plugin class against the live `app`. Loaded instances are tracked in `window.__ignis.plugins` and can be toggled per vault. Nothing is ever written to `.obsidian/plugins/`.

headless-sync's companion (`ignis-headless-sync`) adds a status bar item, a settings tab with start/stop/unlink controls, and a core-sync guard that hides Obsidian's own Sync setting from `core-plugins.json` reads while headless sync is active for that vault, so a different device syncing the "Active core plugins list" can't accidentally re-enable it.

## Demo mode

A separate operating mode for running Ignis as a public-facing demo. Enabled by `DEMO_MODE=true`. When off, none of the demo code runs and the server behaves normally.

In demo mode, each visitor gets a session identified by a cookie. Their vaults are stored on disk under a session-prefixed name (`demo-<sessionId>__<userVaultName>`) to avoid naming collisons; demo middleware translates inbound `?vault=X` and request bodies, and rewrites vault id/name fields in JSON responses on the way out.

The bootstrap endpoint's pre-compressed buffer path is bypassed in demo mode so the response wrapper can rewrite per-session names.

Other demo behaviors:
- Per-session caps on vault count and cumulative bytes, returning 507 when exceeded.
- Proxy allowlist limiting `/api/proxy` to a known-safe set of hosts (no `obsidian.md`/`api.obsidian.md` so account login attempts fail at the network layer).
- A `setInterval` cleanup that removes inactive sessions and orphaned `demo-*` directories, with a recovery redirect that sends users to `/` if their requested vault was wiped under them.
- Server-side plugins (e.g. headless-sync) hidden from the client; enable/disable returns 403.
- The bridge plugin disables any `<input type="email">` or `<input type="password">` it sees anywhere in the document, with a placeholder telling users not to enter credentials.

All server-side demo code lives in `apps/ignis-server/server/demo/`. The client-side hooks live in `packages/shim/src/demo.js`. The deployment example is in `apps/ignis-server/examples/demo/` (tmpfs-mounted vaults, restricted proxy, all the env vars).