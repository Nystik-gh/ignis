---
title: Remote access
description: Reach Ignis beyond localhost.
---

Obsidian relies on a number of APIs that the browser only provides if certain security standards are met, and so in order for Ignis to function properly it needs to be served in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).

This means that if you want to access Ignis from any other origin than `http://localhost` (which is considered secure), you need to either serve Ignis over HTTPS, or add the origin in question to your browser's list of secure origins via experimental settings. If you do not, a number of features, including graph view, backlinks, outline, and more, will not work.

If you also expose your instance to the internet, it is essential to add an [authentication](/docs/security/authentication/) layer in front, in order to prevent unauthorized access and potentially malicious changes to your vault.

## Serving over HTTPS

To serve Ignis over HTTPS, add a TLS terminator in front of it in one of the following ways:

- **A reverse proxy.** Caddy, nginx, or Traefik, using any of the [`examples/`](https://github.com/Nystik-gh/ignis/tree/main/apps/ignis-server/examples) configs. Use this for anything internet-facing.
- **`tailscale serve`.** Puts HTTPS in front of Ignis on a tailnet with no certificate management, for private remote access.
- **A Cloudflare Tunnel.** Reaches Ignis through Cloudflare's edge over HTTPS, with no port forwarding or certificates. Pair it with Cloudflare Access to require a login.

## Running without TLS

For LAN access without a certificate, tell the browser to treat the Ignis origin as a secure origin. It has to be set in every browser, on every client that accesses Ignis.

:::caution
Only use this for LAN access. Do not serve a public, internet-facing endpoint over plain HTTP, or your vault crosses the internet unencrypted. Anything reachable from outside your LAN needs HTTPS.
:::

- **Chromium (Chrome, Edge, Brave, Opera, Vivaldi):** open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge and Brave expose the same flag at `edge://flags` and `brave://flags`), set it to **Enabled**, enter the Ignis origin such as `http://192.168.1.10:8080` (comma-separate several), and relaunch the browser.
- **Firefox:** in `about:config`, add the host to `dom.securecontext.allowlist` (comma-separated). A reverse proxy is more reliable since Firefox may attempt to upgrade resource requests to HTTPS which can break asset loading.
- **Safari:** has no equivalent setting so requires the use of TLS.
