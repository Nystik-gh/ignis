---
title: Authentication
description: Ignis has no built-in login. Put access control in front of it.
---

Ignis has no built-in authentication and serves plain HTTP by default, so both authentication and TLS termination come from whatever you put in front of it. Reaching it beyond localhost also needs a secure context, which [Remote access](/docs/security/remote-access/) covers.

:::caution
Do not run Ignis on a public network without authentication. Anyone with the URL can read and write every file in the vault.
:::

If Ignis is reachable beyond your own machine, put an authentication layer in front. Alternatives include:

- A reverse proxy with Basic Auth (nginx, Caddy, Traefik).
- An SSO proxy such as Authelia, Authentik, or OAuth2 Proxy.
- A VPN (Tailscale, WireGuard).
- Cloudflare Access.

For a ready-made starting point, [`examples/`](https://github.com/Nystik-gh/ignis/tree/main/apps/ignis-server/examples) has two complete Caddy stacks that put a login in front of Ignis and handle HTTPS.

- **[Basic Auth](https://github.com/Nystik-gh/ignis/tree/main/apps/ignis-server/examples/caddy-basic-auth)** prompts for a username and password on each new browser session. The simplest solution.
- **[Authelia](https://github.com/Nystik-gh/ignis/tree/main/apps/ignis-server/examples/caddy-authelia)** serves a login page with sessions, optional two-factor, and SSO.
