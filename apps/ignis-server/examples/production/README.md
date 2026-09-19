# Production deployment (linux/amd64)

A minimal production template: one Ignis container pinned to `linux/amd64`, persistent volumes for vaults and state, a healthcheck, and optional hardening knobs commented out.

## Prerequisites

- Docker + Docker Compose on a linux/amd64 host (or a VM/CI that produced the image; see [docs/docker-build.md](../../../docs/docker-build.md))
- A prebuilt image, either pulled (`nobbe/ignis:0.8.10`) or built from source

## Running it

```bash
docker compose up -d
```

First boot downloads Obsidian 1.13.7 into the `obsidian-app` volume (1-2 minutes). Then open `http://<server>:8080`.

## Volumes (what to back up)

| Path | Contents | Backup |
| ---- | -------- | ------ |
| `./vaults` | Your notes, one subfolder per vault | **Yes** |
| `./data` | Server plugin config, sync states, tokens | **Yes** |
| `obsidian-app` | Downloaded/extracted Obsidian | No (rebuildable) |

## Environment variables

See the commented lines in [`docker-compose.yml`](docker-compose.yml) and the full table in the [official environment docs](../../../docs/ignis官方说明文档.md). The ones that matter most for production:

| Variable | When to set |
| -------- | ----------- |
| `WS_ORIGINS` | You proxy Ignis behind HTTPS on a domain; set it to your origin so foreign websites can't connect to the vault WebSocket. |
| `PROXY_ALLOW_PRIVATE_HOSTS` | Plugins need to reach LAN services through the CORS proxy. Keep it minimal; it reopens SSRF to those targets. |
| `WRITE_COALESCE_MS` | Vaults live on rclone/NFS/SMB; debounce rapid writes (max 60000). |
| `AUTO_CREATE_DEFAULT` | You want a "My Vault" created automatically on first boot. |

## Security notes

- Ignis has **no built-in authentication**. Put it behind a reverse proxy (see the [`caddy-basic-auth`](../caddy-basic-auth/) and [`caddy-authelia`](../caddy-authelia/) examples) or a VPN.
- Serve over **HTTPS** unless you only access it from `localhost`: browsers disable crypto and clipboard APIs on insecure origins, breaking parts of Obsidian.
- The healthcheck hits `/api/version`; `start_period: 180s` covers the first-run Obsidian download.

## Upgrading

1. `docker compose pull` (or rebuild: `node apps/ignis-server/scripts/build-image.js --push`)
2. `docker compose up -d`
3. The entrypoint compares `OBSIDIAN_VERSION` against the `obsidian-app` volume stamp and re-downloads Obsidian automatically when the pinned version changed.
