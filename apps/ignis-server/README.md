# Ignis Server

The self-hosted Docker variant of Ignis. For the project overview, feature list, and what works / what doesn't, see the [root README](../../README.md).

## Contents

- [Authentication](#authentication)
- [Secure context (HTTPS)](#secure-context-https)
- [Setup with Docker Compose](#setup-with-docker-compose)
- [Volumes](#volumes)
- [Environment Variables](#environment-variables)
- [Migrating an existing vault](#migrating-an-existing-vault)
- [Upgrading Obsidian](#upgrading-obsidian)
- [Backups](#backups)

## Authentication

Ignis has **no built-in authentication** and serves plain HTTP by default. Both authentication and TLS termination are expected to be handled by whatever you put in front of it.

> [!IMPORTANT]
> HTTPS is functionally required, not just for confidentiality. Browser crypto and clipboard APIs are gated to secure contexts, so plain HTTP at a non-localhost origin breaks graph view, the outline, Sync, and more. `localhost` is exempt. See [Secure context (HTTPS)](#secure-context-https).

If you are exposing Ignis to the internet, **you should really** put an authentication layer in front of it. Options include:

- A reverse proxy with Basic Auth (nginx, Caddy, Traefik)
- An SSO proxy like Authelia, Authentik, or OAuth2 Proxy
- A VPN (Tailscale, WireGuard)
- Cloudflare Application Tunnel

Example configurations for Basic Auth and Authelia are in [`examples/`](examples).

> [!CAUTION]
> Do not run Ignis on a public network without auth. Anyone with the URL can read and write your vault files.

Ignis also runs a cross-origin proxy (`/api/proxy`) that reaches any public host by default. It rejects private, loopback, and link-local addresses, and you can narrow it to an allowlist or disable it entirely from the proxy settings in the Ignis settings panel. A companion direct-fetch host list (same Settings > Security panel) marks hosts the browser fetches directly instead of through the proxy, for CORS-friendly hosts.

## Secure context (HTTPS)

Browsers only expose the crypto and clipboard APIs Obsidian relies on in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Served over plain HTTP at a non-localhost origin (a LAN IP or a bare domain), Ignis loses graph view, backlinks, the outline, some clipboard operations, and Sync, and shows a warning banner. `http://localhost` and `http://127.0.0.1` are treated as secure, so a purely local instance is unaffected.

Three ways to get a secure context:

- **A TLS reverse proxy.** Caddy, nginx, Traefik, or any of the [`examples/`](examples) configs. For anything internet-facing.
- **`tailscale serve`.** Puts HTTPS in front of Ignis on a tailnet with no certificate management. For private remote access.
- **Mark the origin trusted in the browser.** The most direct fix for LAN access without TLS: tell the browser to treat the Ignis origin as a secure context. No server changes, but per-browser and per-machine, so every client has to set it.
  - **Chromium (Chrome, Edge, Brave, Opera, Vivaldi):** open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge and Brave expose the same flag at `edge://flags` and `brave://flags`), set it to **Enabled**, enter the Ignis origin in the box (for example `http://192.168.1.10:8080`; comma-separate several), and relaunch the browser.
  - **Firefox:** in `about:config`, add the host to `dom.securecontext.allowlist` (comma-separated). Firefox may then try to upgrade sub-resource requests to HTTPS, which can break asset loading, so a reverse proxy is the more reliable option here.
  - **Safari:** no equivalent flag, safari requires TLS.

## Setup with Docker Compose

Example `docker-compose.yml`:

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
      - OBSIDIAN_VERSION=1.12.7
      - PUID=1000
      - PGID=1000
    volumes:
      - ./vaults:/vaults
      - ./data:/app/data
      - obsidian-app:/app/obsidian-app
    restart: unless-stopped

volumes:
  obsidian-app:
```

Then `docker compose up -d`. On first start the container downloads Obsidian from the official source and installs the Obsidian Headless CLI. This takes a minute or two.

To build from source instead of pulling the image, clone the repo and run `docker compose up` against the [`docker-compose.yml`](docker-compose.yml) in this directory.

## Volumes

| Mount | Description |
| ----- | ----------- |
| `/vaults` | Vault storage. Each subdirectory is a vault. |
| `/app/data` | State persistence for various Ignis-specific functionality: plugin management, headless sync config, etc. |
| `/app/obsidian-app` | Cached Obsidian assets. Persisting this avoids re-downloading on container recreate. |

### Ownership on NFS shares

For NFS shares with `root_squash`, set the share's owner to `PUID`/`PGID` or export the share with `no_root_squash`, so that `PUID`/`PGID` can read and write `/vaults`, `/app/data`, and `/app/obsidian-app`. The container chowns these paths to `PUID`/`PGID` at startup, which `root_squash` blocks. When the chown fails, the container still runs, and file access falls to the mount's own permissions, so Ignis works only where `PUID`/`PGID` can already read and write.

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `PORT` | Server listen port | `8080` |
| `VAULT_ROOT` | Path to vault storage inside the container | `/vaults` |
| `DATA_ROOT` | Path to persistent data (plugin config, sync state, auth tokens) | `/app/data` |
| `OBSIDIAN_VERSION` | Obsidian version to download | `1.12.7` |
| `OBSIDIAN_ASSETS_PATH` | Where the extracted Obsidian app files live. Override if you're pointing at a pre-extracted directory instead of letting the entrypoint download. | `/app/obsidian-app` |
| `OBSIDIAN_PACKAGE` | Path to a pre-placed Obsidian package to unpack on first run instead of downloading, for offline or restricted networks. Accepts `.deb` (the form obsidian.md distributes), `.asar.gz`, or `.asar`. | unset |
| `AUTO_CREATE_DEFAULT` | When `true`, creates a "My Vault" vault on startup if no vaults exist. Useful for fresh installs. | `false` |
| `PUID` | User ID for file ownership | `1000` |
| `PGID` | Group ID for file ownership | `1000` |
| `WRITE_COALESCE_MS` | Debounce window (ms) for rapid writes. On slow filesystems (rclone, NFS, SMB), set an appropriate duration. | `0` |
| `WS_ORIGINS` | Comma-separated allowlist of `Origin` headers accepted on the WebSocket endpoint. When unset, any origin is accepted. | unset |
| `PROXY_ALLOW_PRIVATE_HOSTS` | Comma-separated IPs or IPv4 CIDRs the cross-origin proxy may reach despite the private-address block, for LAN services. Matched against the resolved IP. Reopens SSRF to the listed targets. | unset |

Demo mode adds its own set of env vars (per-session vaults, auto-cleanup, proxy allowlist, login blocking). See [`examples/demo/`](examples/demo/) if you want to run a public demo deployment.

## Offline / restricted-network install

If the container can't reach GitHub on first run (air-gapped or restricted networks), download Obsidian yourself from [obsidian.md](https://obsidian.md/download) (the `.deb`), mount it into the container, and point `OBSIDIAN_PACKAGE` at it:

```yaml
    volumes:
      - ./obsidian_1.12.7_amd64.deb:/packages/obsidian.deb:ro
    environment:
      - OBSIDIAN_PACKAGE=/packages/obsidian.deb
```

On first run the entrypoint unpacks that instead of downloading. Match the version this release pins (see the OCI label and CHANGELOG); a mismatch logs a warning and still boots. `.asar.gz` and `.asar` are also accepted.

## Migrating an existing vault

Each subdirectory of `/vaults` is treated as a separate vault, so dropping in an existing Obsidian vault directory will make it available in Ignis.

## Upgrading Obsidian

Obsidian releases can include changes that break the compatibility shim. Each Ignis release pins a known-working Obsidian version through the `OBSIDIAN_VERSION` env var, so the recommended path is to wait for an Ignis release that bumps the version, pull the new image, and restart.

If you want to try a newer Obsidian version before Ignis updates, set `OBSIDIAN_VERSION` in your compose file. The entrypoint will download that version on next start, but there is no guarantee it will work cleanly with the current shim.

## Backups

Vault data lives as ordinary files in `/vaults`. Back it up however you back up other server-side data; Ignis does not provide a built-in backup mechanism.
