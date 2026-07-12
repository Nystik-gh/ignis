---
title: Limitations
description: Rough edges when running Electron apps in a browser.
---

Running an Electron app in the browser has some challenges, and not all of them are perfectly solvable. Ignis attempts to provide as accurate API shims as necessary, but there are a number of known gaps. This page enumerates broad feature limitations; for gaps in plugin functionality, see [Plugin compatibility](/docs/using/plugin-compatibility/).

## Importing files

Some plugins, such as the Importer, require a file picker that is not possible to emulate in the browser, so choosing files in such cases is done in two stages: the first time you run the action, it asks you to select your files and Ignis stages them; you then run the same action again, and Ignis feeds the staged file(s) to the plugin.

## Stored secrets

A plugin can encrypt sensitive data with Electron's `safeStorage`, which uses the OS's encryption system. Ignis shims `safeStorage`, but the browser has no equivalent functionality, so the data is stored as plaintext instead. Server-side encryption is planned. Until then, treat any secret a plugin stores this way as unprotected.

## Secure context

Some of Obsidian's features need the browser's crypto and clipboard APIs, which are available only in a [secure context](/docs/security/remote-access/): over HTTPS, or on `localhost`. Ignis cannot bypass browser security rules, so over plain HTTP at any other origin those features will not work.

## Smaller differences

- **Spellcheck languages.** A page cannot choose the browser's spellcheck languages, so Ignis disables the setting and points you to your browser's own language settings.
- **Native menus.** The native menus option under Appearance relies on Electron's menu APIs, so Ignis leaves it turned off.
