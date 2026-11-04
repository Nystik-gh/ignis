---
title: Features
description: Things Ignis adds on top of Obsidian.
---

Ignis adds a few additional features to Obsidian, mostly around improving usability in a browser. For example: getting files in and out, and opening things by URL.

## Uploading and downloading

Right-click a file for **Download**, or a folder for **Download as ZIP** and **Upload file**. The ribbon has an upload button for the current folder, and dragging files from your desktop into the file explorer also uploads them.

## Opening a vault, workspace, or note by URL

Ignis reads query parameters when the page loads. They combine: `/?vault=Work&file=Projects%2FPlan.md`.

**`vault`** opens the named vault. Without it, the last-used vault opens.

**`workspace`** opens a saved workspace in the tab. Its layout is stored per workspace name, so different tabs can hold different workspaces without overwriting each other.

**`file`** opens a note once the vault has loaded. The value is the note's vault path, URL-encoded. The `.md` extension can be left off, and a bare note name resolves the way a wiki link does.

The right-click menu on a note has an "as Ignis URL" option that copies a full link with the vault and file filled in.

## Saving to your home screen or desktop

You can save Ignis to your home screen or desktop to use it without browser elements cluttering the UI. Saving as standalone requires Ignis to be served over HTTPS (see [Secure context](/docs/requirements/#secure-context)).

- **Desktop:** use the install option in the browser's address bar or menu.
- **Android:** open the browser menu and choose **Add to Home screen**.
- **iOS:** tap **Share**, then **Add to Home Screen**.

If Ignis is hosted behind an auth proxy (which it should be, see: [Authentication](/docs/security/authentication/)) iOS doesn't fetch the icon for the homescreen. You'll need to set up a bypass for the path `/assets/apple-touch-icon.png` in order for the icon to load properly.

## Refreshing the vault from disk

The `Refresh vault from disk` command picks up external changes not tracked by Ignis, such as edits made on another machine to a vault on a network share.
