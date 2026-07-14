# Public demo deployment

This example runs Ignis as a public, no-auth demo where anyone with the URL can spin up a transient vault and try the editor. The live demo at <https://ignis-demo.thiefling.com> uses this configuration.

Demo mode changes the security and lifecycle model:

- **Per-session vaults.** Each visitor gets their own isolated set of vaults, tracked by a session cookie. Sessions don't share storage.
- **Transient files.** Vaults live on tmpfs in the example compose file, so everything is wiped on container restart and on session expiry.
- **Auto-cleanup.** Sessions expire after a period of inactivity; their vaults are removed in-process.
- **Capacity caps.** Concurrent sessions, vaults per session, and bytes per session are bounded, so a single visitor can't fill the disk and the host can't be flooded with sessions.
- **Proxy allowlist.** The CORS proxy is restricted to a known-safe domain list so the public demo can't be used as an open relay.
- **Login blocked.** Obsidian account login is blocked at both the proxy and the UI, so visitors can't accidentally enter credentials into a server they don't control.

## Running it

```bash
docker compose up -d
```

The bundled [`docker-compose.yml`](docker-compose.yml) builds Ignis from the parent directory, mounts a 20 MB tmpfs at `/vaults`, and configures the demo limits. Adjust the env vars below for your own deployment.

The compose file serves plain HTTP on `:8080`. Any networked deployment must be fronted by HTTPS (a TLS reverse proxy, `tailscale serve`, etc.) or core obsidian features (graph view, the outline, clipboard, Sync) are disabled and a warning banner is shown; the public demo works because it sits behind HTTPS. Accessing it over `localhost` works since localhost over HTTP is considered a trusted origin by browsers.

## Demo environment variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `DEMO_MODE` | Enable demo mode (per-session vaults, auto-cleanup, proxy allowlist, login blocking). | `false` |
| `DEMO_MAX_SESSIONS` | Concurrent demo session cap. New visitors get a 503 capacity page when full. | `20` |
| `DEMO_VAULTS_PER_SESSION` | Max vaults per session (vault create returns 507 past this). | `3` |
| `DEMO_SESSION_QUOTA_BYTES` | Cumulative byte budget per session across all session vaults. | `716800` |
| `DEMO_TIMEOUT_MS` | Inactivity timeout before a demo session and its vaults are cleaned up. | `1800000` |
| `DEMO_TEMPLATE_DIR` | Directory copied into each new demo vault. | `server/demo-template/` |

The standard Ignis env vars (`PORT`, `VAULT_ROOT`, `OBSIDIAN_VERSION`, etc.) still apply. See the [environment variables documentation](https://ignis.thiefling.com/docs/server/environment/) for those.

## Custom starter vault

The bundled `server/demo-template/` is a minimal walkthrough of what Ignis is. To ship a richer starter vault for your own demo without committing it to the repo, mount a directory at `/app/demo-template` and point `DEMO_TEMPLATE_DIR` at it. The compose file has the wiring commented out.
