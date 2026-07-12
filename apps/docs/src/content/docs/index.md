---
title: Overview
description: Introduction to Ignis.
---

Ignis is a harness for accessing Obsidian remotely through a browser. Using a shim layer, Ignis implements all the necessary APIs that Obsidian is built on, but inside a browser instead of the Electron app shell. This lets Obsidian run natively in any modern browser with (almost) complete features, including themes, most plugins, and all core functionality.

## What Ignis provides

- Fully web-native Obsidian user experience, no need for clunky remote-desktop solutions with Kasm.
- Easy file upload and download.
- Live editing of the same vault in multiple tabs and across devices.
- Full Obsidian Sync support (including [Headless Sync](/docs/using/server-plugins/)).
- Loading different workspaces in different tabs.
- Mobile UI on small screens.
- Theme and plugin support, with a few caveats (see [limitations](/docs/using/limitations/)).
- A server-side plugin system (work in progress).

## Setup

Ignis ships as a self-hosted server.

- Start with [Requirements](/docs/requirements/) to see what you need.
- Follow [Deploy with Docker](/docs/server/deploy/) to get the server running.
