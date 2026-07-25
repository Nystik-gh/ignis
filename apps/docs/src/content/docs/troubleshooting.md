---
title: Troubleshooting
description: Common problems running a self-hosted Ignis server.
---

If you run into a problem, check the browser's developer console (F12) and the container logs for the error. View the container logs with:

```bash
docker compose logs -f
```

If you can't find your problem below, search the [issue tracker](https://github.com/Nystik-gh/ignis/issues) to see if someone else has reported the same problem. If not, open a new issue.

## Common problems

### The app warns about an insecure connection

Ignis shows this warning when it is reached over plain HTTP from any origin other than `localhost`. The browser blocks certain APIs on such origins, and Obsidian features that depend on them break. Solved by serving Ignis over HTTPS, or marking the origin as secure in the browser; both options are covered in [Remote access](/docs/security/remote-access/).

To verify that the problem is caused by an insecure context, check the browser console (F12) for an `[ignis]` line naming the blocked API.

### Files won't save

Check your container logs for permission errors. Write problems are commonly the result of a mismatch between the container's `PUID`/`PGID` and the owner of the mounted host folders. Set `PUID` and `PGID` to the host user's IDs so Ignis writes as that user. See [File ownership](/docs/server/deploy/#file-ownership) for details.

### A plugin isn't working

Plugin problems usually come from a plugin relying on a missing or incompatible API. Check the browser console (F12), and look for lines that start with `[ignis] Unshimmed require:`, `[shim:MISS]`, or `Plugin failure:`. Check the [issue tracker](https://github.com/Nystik-gh/ignis/issues) for existing reports of the plugin, and [issue #9](https://github.com/Nystik-gh/ignis/issues/9), which tracks what plugins have been tested along with any compatibility notes. If you can't find a report or a compatibility note, create a new issue.

### A sync plugin can't connect

The usual cause is a sync server on a private address: Ignis relays plugin requests through its server, which refuses private addresses until they are allowed. Sync over a WebSocket has its own requirements, since the browser opens that connection itself. Both are covered in [Sync connectivity](/docs/sync/).

### A vault doesn't appear in the vault list

Check the container logs for a `[config] Skipping unreadable vault entry` line, which names the folder and why it was skipped. `EACCES` means the folder is not readable by the `PUID`/`PGID` user; see [File ownership](/docs/server/deploy/#file-ownership). `ENOENT` on a symlinked folder means the link target is not mounted inside the container; see [Vaults on other mounts](/docs/server/deploy/#vaults-on-other-mounts).

### Obsidian won't fetch on first run

If you are on a restricted network, the container may not be able to pull the app package from Obsidian's release channel. This can be solved by downloading the Obsidian package yourself and pointing `OBSIDIAN_PACKAGE` at it to skip the download. The steps are in [Offline install](/docs/server/deploy/#offline-install).
