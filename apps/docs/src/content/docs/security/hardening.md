---
title: Hardening
description: Important security considerations.
---

Serving Ignis in a [secure context](/docs/security/remote-access/) and putting [authentication](/docs/security/authentication/) in front are the essentials for any exposed instance. Two further settings shape the security surface, and are worth understanding before you open it up.

## The cross-origin proxy

Ignis runs a server-side proxy at `/api/proxy` so that plugins can reach hosts the browser would otherwise block by CORS. Since these requests pass through the server, the security surface extends to the server's network position.

By default the proxy reaches any public host and rejects private, loopback, and link-local addresses, which stops it from being turned into a probe of your internal network (a server-side request forgery, or SSRF, surface). The following two settings let you change what the proxy can reach:

- **The allowlist.** From the proxy settings in the [Settings](/docs/using/settings/) panel, you can narrow the proxy to specific hosts, or turn it off entirely if no plugin needs it. A narrower allowlist is a smaller risk surface.
- **`PROXY_ALLOW_PRIVATE_HOSTS`.** This environment variable grants the proxy access to specific private IPs or CIDRs, if you need Obsidian to access any LAN services. This deliberately reopens SSRF only to the targets you list, so keep it minimal and never widen it to a private range you do not control.

There is also a direct-fetch list setting that marks CORS-friendly hosts the browser fetches directly, bypassing the proxy. These requests do not pass through the server and so are not affected by the proxy's security implications.

## WebSocket origins

Ignis pushes vault changes to open tabs over a WebSocket, and by default it accepts a connection from any origin. That means a page on another site, opened by a logged-in user, could connect to your instance. Set the environment variable [`WS_ORIGINS`](/docs/server/environment/) to the origins you serve Ignis from, and connections from anywhere else are refused.
