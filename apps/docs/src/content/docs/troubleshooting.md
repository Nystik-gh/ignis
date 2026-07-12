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

### Basic Obsidian features don't work

If basic features like the graph view or backlinks are broken, verify that you are reaching Ignis over HTTPS. Plain HTTP access from any origin other than `localhost` results in certain APIs being blocked by the browser. For HTTPS, or a LAN option without a certificate, see [Remote access](/docs/security/remote-access/).

### Files won't save

Check your container logs for permission errors. Write problems are commonly the result of a mismatch between the container's `PUID`/`PGID` and the owner of the mounted host folders. Set `PUID` and `PGID` to the host user's IDs so Ignis writes as that user. See [File ownership](/docs/server/deploy/#file-ownership) for details.

### A plugin isn't working

Plugin problems usually come from a plugin relying on a missing or incompatible API. Check the browser console (F12), and look for lines that start with `[ignis] Unshimmed require:`, `[shim:MISS]`, or `Plugin failure:`. Check the [issue tracker](https://github.com/Nystik-gh/ignis/issues) for existing reports of the plugin, and [issue #9](https://github.com/Nystik-gh/ignis/issues/9), which tracks what plugins have been tested along with any compatibility notes. If you can't find a report or a compatibility note, create a new issue.

### Obsidian won't fetch on first run

If you are on a restricted network, the container may not be able to pull the app package from Obsidian's release channel. This can be solved by downloading the Obsidian package yourself and pointing `OBSIDIAN_PACKAGE` at it to skip the download. The steps are in [Offline install](/docs/server/deploy/#offline-install).
