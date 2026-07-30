---
title: Sync connectivity
description: Getting sync plugins connected.
---

A sync plugin that works in desktop Obsidian can fail to connect from Ignis. In Ignis, HTTP requests are relayed through the Ignis server and subject to security rules to prevent malicious network scanning. WebSocket connections are opened by the browser and so are subject to the browser's security rules. If you are having issues with getting a sync plugin to work, the sections below detail the most common cases and solutions.

## Servers on a private address

Ignis refuses to relay requests to private, loopback, and link-local addresses by default, so a sync server on your LAN, in Docker, or on a tailnet is blocked until you allow it. You can allow connections to the sync server with either of these settings:

- **[`PROXY_ALLOW_PRIVATE_HOSTS`](/docs/server/environment/).** Grants the Ignis server access to the IP addresses or CIDRs you list; hostnames are not accepted. Applies after a container restart. The IP must be accessible from your Ignis host.
- **Direct-fetch hosts.** Set under Settings > Ignis > General > Security ([Settings](/docs/using/settings/)); applies after a tab refresh. The browser fetches these hosts directly instead of relaying through the Ignis server. If you use this, the sync server must be reachable from your browser, and it must allow cross-origin requests (CORS) from the Ignis origin.

See [Hardening](/docs/security/hardening/) for what allowing a private host exposes.

## Servers reached over WebSocket

A plugin that syncs over a WebSocket connects straight from your browser to the sync server. That server has to be reachable from the browser, and over `wss://` when Ignis is served over HTTPS, since a browser blocks a plaintext `ws://` connection from a secure page. A certificate the browser trusts, or `tailscale serve` in front of the sync server, usually solves the issue.

## If it still does not connect

Try connecting using an IP address rather than a hostname. A hostname has to resolve on the Ignis server, and the Ignis server does not necessarily resolve hostnames your browser does.

Check the browser console (F12) for failed requests. A request Ignis refused names the blocked address and the setting to unblock it.

If none of this gets the plugin connected, [open an issue](https://github.com/Nystik-gh/ignis/issues) with the details of your setup.
