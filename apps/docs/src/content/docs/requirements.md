---
title: Requirements
description: What you need before running Ignis.
---

## Host

A machine with Docker installed, either Docker Engine on a server or Docker Desktop on a workstation. If you are unfamiliar with Docker, you can read about it here: [Docker Documentation](https://docs.docker.com/get-started/)

## Browser

A modern browser. Chrome, Brave, and Firefox are tested. Safari has had only limited testing.

## Secure context

Obsidian needs the browser's crypto and clipboard APIs, which browsers expose only over HTTPS or on `localhost`.

Over plain HTTP at any other origin, such as a LAN IP or a bare domain, the context is considered insecure and several Obsidian features will not function. See the [Remote access](/docs/security/remote-access/) page for how to set it up, and for a workaround if you wish to run without TLS (not recommended).

## Access control

Ignis has no built-in authentication at this moment. Any instance reachable beyond the local machine belongs behind a reverse proxy or VPN. See [Authentication](/docs/security/authentication/).

:::caution
Do not expose Ignis to the internet without authentication in front of it. Anyone who can reach the URL can read and write every file in the vault.
:::

---

For the setup guide, see [Deploy with Docker](/docs/server/deploy/).
