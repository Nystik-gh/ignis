# Ignis Server

The self-hosted Docker variant of Ignis. For the project overview, feature list, and what works / what doesn't, see the [root README](../../README.md).

## Contents

- [Authentication](#authentication)
- [Setup with Docker Compose](#setup-with-docker-compose)
- [Volumes](#volumes)
- [Environment Variables](#environment-variables)
- [Migrating an existing vault](#migrating-an-existing-vault)
- [Upgrading Obsidian](#upgrading-obsidian)
- [Backups](#backups)

## Authentication

Ignis now includes **built-in authentication** that you can enable via environment variables. No reverse proxy required.

### Built-in Auth (new)

Set one or both of these environment variables to enable authentication:

| Variable | Description |
| -------- | ----------- |
| `IGNIS_AUTH_USER` | Username for Basic Auth |
| `IGNIS_AUTH_PASS` | Password (plain text — hashed on first start) |
| `IGNIS_API_KEY` | API key for programmatic access (`X-API-Key` header) |
| `IGNIS_AUTH_TIMEOUT_MS` | Session timeout in ms (default: `86400000` = 24h) |

When `IGNIS_AUTH_USER` and `IGNIS_AUTH_PASS` are set:
- Browser requests without a session cookie are redirected to a login page at `/login`
- API requests return `401 Unauthorized`
- After successful login, a session cookie is set
- Basic Auth credentials are also accepted on any request (and auto-create a session)

When `IGNIS_API_KEY` is set:
- Pass `X-API-Key` header with the key value
- No session cookie — stateless, ideal for scripts and Obsidian Headless sync

Example `docker-compose.yml`:
```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
      - IGNIS_AUTH_USER=admin
      - IGNIS_AUTH_PASS=your-password
      - IGNIS_API_KEY=sk-xxxxxxxxxxxxxxxx
    volumes:
      - ./vaults:/vaults
```

> [!TIP]
> If you use `IGNIS_AUTH_PASS` with a plain-text password, it will be hashed on first startup using PBKDF2-SHA512. After the first start, you can replace the plain text with the hash value for better security.

### API Endpoints

When auth is enabled, the following endpoints are available:

- `GET /api/auth/status` — Check if authenticated
- `POST /api/auth/login` — `{ "username": "...", "password": "..." }`
- `POST /api/auth/logout` — Clear session

### External Auth (alternative)

If you prefer to handle authentication externally:

- A reverse proxy with Basic Auth (nginx, Caddy, Traefik)
- An SSO proxy like Authelia, Authentik, or OAuth2 Proxy
- A VPN (Tailscale, WireGuard)
- Cloudflare Application Tunnel

Example configurations for Basic Auth and Authelia are in [`examples/`](examples).

> [!CAUTION]
> Do not run Ignis on a public network without auth. Anyone with the URL can read and write your vault files.

Ignis also runs a cross-origin proxy (`/api/proxy`) that reaches any public host by default. It rejects private, loopback, and link-local addresses, and you can narrow it to an allowlist or disable it entirely from the proxy settings in the Ignis settings panel.

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

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `PORT` | Server listen port | `8080` |
| `VAULT_ROOT` | Path to vault storage inside the container | `/vaults` |
| `DATA_ROOT` | Path to persistent data (plugin config, sync state, auth tokens) | `/app/data` |
| `OBSIDIAN_VERSION` | Obsidian version to download | `1.12.7` |
| `OBSIDIAN_ASSETS_PATH` | Where the extracted Obsidian app files live. Override if you're pointing at a pre-extracted directory instead of letting the entrypoint download. | `/app/obsidian-app` |
| `AUTO_CREATE_DEFAULT` | When `true`, creates a "My Vault" vault on startup if no vaults exist. Useful for fresh installs. | `false` |
| `PUID` | User ID for file ownership | `1000` |
| `PGID` | Group ID for file ownership | `1000` |
| `WRITE_COALESCE_MS` | Debounce window (ms) for rapid writes. On slow filesystems (rclone, NFS, SMB), set an appropriate duration. | `0` |
| `WS_ORIGINS` | Comma-separated allowlist of `Origin` headers accepted on the WebSocket endpoint. When unset, any origin is accepted. | unset |
| `IGNIS_AUTH_USER` | Username for built-in Basic Auth. | unset |
| `IGNIS_AUTH_PASS` | Password for built-in Basic Auth (plain text — hashed on first start). | unset |
| `IGNIS_API_KEY` | API key for programmatic access via `X-API-Key` header. | unset |
| `IGNIS_AUTH_TIMEOUT_MS` | Session timeout in milliseconds for built-in auth. | `86400000` (24h) |

Demo mode adds its own set of env vars (per-session vaults, auto-cleanup, proxy allowlist, login blocking). See [`examples/demo/`](examples/demo/) if you want to run a public demo deployment.

## Migrating an existing vault

Each subdirectory of `/vaults` is treated as a separate vault, so dropping in an existing Obsidian vault directory will make it available in Ignis.

## Upgrading Obsidian

Obsidian releases can include changes that break the compatibility shim. Each Ignis release pins a known-working Obsidian version through the `OBSIDIAN_VERSION` env var, so the recommended path is to wait for an Ignis release that bumps the version, pull the new image, and restart.

If you want to try a newer Obsidian version before Ignis updates, set `OBSIDIAN_VERSION` in your compose file. The entrypoint will download that version on next start, but there is no guarantee it will work cleanly with the current shim.

## Backups

Vault data lives as ordinary files in `/vaults`. Back it up however you back up other server-side data; Ignis does not provide a built-in backup mechanism.
