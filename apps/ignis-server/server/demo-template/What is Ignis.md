# What is Ignis

Ignis lets you run Obsidian in a web browser, with your vault stored on a server instead of your local disk. You open a URL and get the full Obsidian editor running in a regular browser tab: markdown, canvas, themes, community plugins, all of it.

Obsidian is a local-first app, so every install holds its own vault and its own state. Obsidian Sync replicates the vault between devices, but each device still runs its own local Obsidian with its own open notes, workspaces, and plugin configuration. The other way to reach a single Obsidian instance from elsewhere has been VNC or remote desktop, which is sluggish, bandwidth-heavy, and feels less like using an app than remote-controlling a computer. Ignis is a third option: Obsidian running on a server you control, accessed through any browser, with the vault and its state on the server.

## How it works

Ignis is made up of two parts: a compatibility layer, and a bridge plugin.

### The compatibility layer

The compatibility layer has two halves.

The first is a **server** that holds your vault and exposes its files over HTTP and WebSocket. It serves Obsidian's own application files to the browser when you open the page, and answers the filesystem questions Obsidian asks while it runs.

The second is a **browser-side shim** that loads alongside Obsidian in your tab. It replaces the Node.js and Electron APIs that Obsidian normally relies on, the filesystem module, inter-process communication, Electron's clipboard, dialogs, and so on, with browser-compatible equivalents that route those calls to the server.

Ignis itself doesn't include or distribute any of Obsidian's code. The server downloads Obsidian directly from its official source the first time you start the container, and serves it to your browser unmodified.

### The bridge plugin

The bridge plugin serves as the frontend part of Ignis, **bridging** the functionality of the server and the Obsidian app. It gets installed into each vault automatically.

The plugin provides dedicated settings tabs for Ignis specific configuration and functionality, including management of a server side plugin system (work in progress). It also provides status UI for server signals, and fills some of the obvious gaps that result from running an Electron app in the browser; adding convenient upload and download functionality among other things.

## Plugins and limits

Most plugins built on Obsidian's plugin API work in Ignis, along with themes and snippets. The compatibility layer doesn't cover Node native modules or `child_process`, so plugins that depend on those don't load. For a comprehensive list of what works and what doesn't, see the [documentation](https://ignis.thiefling.com/docs/using/limitations/).

## Self-hosting

Ignis is open source. If you want to run your own instance, pull the image from Docker Hub and `docker compose up -d`. Setup instructions, environment variables, and the full feature list are in the [documentation](https://ignis.thiefling.com/docs/).
