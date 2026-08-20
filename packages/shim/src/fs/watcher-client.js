// Bridges WebSocket file events to the fs shim's metadata/content caches and fs.watch listeners.
// The WebSocket itself is owned by ws-client.js; this module is a consumer.

import { isRecentLocalOp } from "./echo-guard.js";
import { normalize } from "../util/path.js";

const RESYNC_DEBOUNCE_MS = 1000;

export function createWatcherClient(
  metadataCache,
  contentCache,
  fsWatch,
  wsClient,
  transport,
) {
  function handleCreated(msg) {
    const { path, stat } = msg;

    if (!path || isRecentLocalOp(path)) {
      return;
    }

    if (stat) {
      metadataCache.set(path, {
        type: "file",
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
      });
    }

    contentCache.invalidate(path);
    fsWatch._dispatch("created", path);
  }

  function handleFolderCreated(msg) {
    const { path } = msg;

    if (!path || isRecentLocalOp(path)) {
      return;
    }

    metadataCache.set(path, { type: "directory" });
    fsWatch._dispatch("folder-created", path);
  }

  function handleModified(msg) {
    const { path, stat } = msg;

    if (!path || isRecentLocalOp(path)) {
      return;
    }

    if (stat) {
      metadataCache.set(path, {
        type: "file",
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
      });
    }

    contentCache.invalidate(path);
    fsWatch._dispatch("modified", path);
  }

  function handleDeleted(msg) {
    const { path } = msg;

    if (!path || isRecentLocalOp(path)) {
      return;
    }

    metadataCache.delete(path);
    contentCache.invalidate(path);
    fsWatch._dispatch("deleted", path);
  }

  wsClient.subscribe("created", handleCreated);
  wsClient.subscribe("folder-created", handleFolderCreated);
  wsClient.subscribe("modified", handleModified);
  wsClient.subscribe("deleted", handleDeleted);

  let treeRevision = null;

  function setTreeRevision(rev) {
    treeRevision = rev;
  }

  // Diffs a full server tree against the cache; each delta goes through the file watcher event handlers.
  function reconcile(tree) {
    const fresh = new Set(Object.keys(tree).map(normalize));

    for (const [path, meta] of Object.entries(tree)) {
      const existing = metadataCache.get(path);

      if (!existing) {
        if (meta.type === "directory") {
          handleFolderCreated({ path });
        } else {
          handleCreated({
            path,
            stat: { size: meta.size, mtime: meta.mtime, ctime: meta.ctime },
          });
        }
      } else if (
        meta.type === "file" &&
        (existing.mtime !== meta.mtime || existing.size !== meta.size)
      ) {
        handleModified({
          path,
          stat: { size: meta.size, mtime: meta.mtime, ctime: meta.ctime },
        });
      }
    }

    // A cache key absent from the fresh tree was deleted while disconnected.
    // The empty root key is preserved because the tree never lists it.
    for (const key of metadataCache.keys()) {
      if (key === "" || fresh.has(key)) {
        continue;
      }

      handleDeleted({ path: key });
    }
  }

  async function resync() {
    let result;

    try {
      result = await transport.fetchTree(treeRevision);
    } catch (e) {
      console.warn("[shim:fs] tree resync failed:", e);
      return;
    }

    if (result.notModified) {
      return;
    }

    treeRevision = result.etag;
    reconcile(result.tree);
  }

  // Coalesce a burst of opens into a single resync once the socket settles.
  let resyncTimer = null;

  function scheduleResync() {
    if (resyncTimer) {
      clearTimeout(resyncTimer);
    }

    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      resync();
    }, RESYNC_DEBOUNCE_MS);
  }

  wsClient.onOpen(scheduleResync);

  function connect(vaultId) {
    wsClient.connect(vaultId);
  }

  function disconnect() {
    wsClient.disconnect();
  }

  return {
    connect,
    disconnect,
    reconcile,
    setTreeRevision,
  };
}
