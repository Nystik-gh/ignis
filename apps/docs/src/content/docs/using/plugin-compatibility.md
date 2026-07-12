---
title: Plugin compatibility
description: Which community plugins run in a browser, and which cannot.
---

Whether a plugin works depends on the APIs it uses. Most plugins are built on Obsidian's plugin API, which Ignis supports, so they run unchanged. When a plugin does fail, it is usually because it needs a Node or operating-system feature the browser does not have.

## What does not work

A plugin will not work if it needs any of these:

- **An external program.** Launched through Node's `child_process`.
- **A raw network socket.** Opened through Node's `net`.
- **A native module.** Loaded from a compiled `.node` binary.

Compatibility for specific community plugins is tracked in [issue #9](https://github.com/Nystik-gh/ignis/issues/9).
