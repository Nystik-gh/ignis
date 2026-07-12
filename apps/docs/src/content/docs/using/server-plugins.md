---
title: Server plugins
description: Ignis plugins that run on the server.
---

Server plugins are Ignis's own plugins that run on the server, separate from Obsidian's community plugins. You enable them per vault from the **Ignis Core Plugins** tab in Obsidian's settings.

## Headless Sync

While Ignis supports the Obsidian Sync core plugin, that plugin can only run when Obsidian is loaded in a browser tab, so it stops syncing once you close the tab. Headless Sync runs the same Obsidian Sync on the server instead, through the `obsidian-headless` CLI, so a vault keeps syncing even without a browser tab open.

Enable it for a vault in the Ignis Core Plugins tab, then sign in with your Obsidian Sync account and link the vault from its settings tab. Headless Sync will continuously sync your vault in the background, resuming on container restart.
