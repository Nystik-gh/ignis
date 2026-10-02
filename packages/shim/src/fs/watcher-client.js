// Bridges WebSocket file events to the fs shim's metadata/content caches and fs.watch listeners.
// The WebSocket itself is owned by ws-client.js; this module is a consumer.

import { isRecentSentOp, sentOpCount } from "./echo-guard.js";
import { hasUnconfirmedWrite } from "./write-coalescer.js";
import { normalize } from "../util/path.js";

const RESYNC_DEBOUNCE_MS = 1000;
const METADATA_CHANNEL = "metadata";

function parentDir(path) {
  const lastSlash = path.lastIndexOf("/");

  return lastSlash < 0 ? "" : path.slice(0, lastSlash);
}

export function createWatcherClient(
  metadataCache,
  contentCache,
  fsWatch,
  wsClient,
  transport,
) {
  function hasLocalChange(path) {
    return isRecentSentOp(path) || hasUnconfirmedWrite(path);
  }

  function deleteSubtreeExceptUnconfirmed(dir) {
    const norm = normalize(dir);
    const subtree = metadataCache
      .keys()
      .filter((key) => key === norm || key.startsWith(norm + "/"));
    const kept = new Set();

    for (const key of subtree) {
      if (!hasUnconfirmedWrite(key)) {
        continue;
      }

      // keep full parent dir structure
      for (let p = key; p !== norm; p = parentDir(p)) {
        kept.add(p);
      }

      kept.add(norm);
    }

    const removed = subtree.filter((key) => !kept.has(key));

    for (const key of removed) {
      metadataCache.delete(key);
    }

    return removed;
  }

  function handleCreated(msg) {
    const { path, stat } = msg;

    if (!path || hasLocalChange(path)) {
      return false;
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

    return true;
  }

  function handleFolderCreated(msg) {
    const { path } = msg;

    if (!path || hasLocalChange(path)) {
      return false;
    }

    metadataCache.set(path, { type: "directory" });
    fsWatch._dispatch("folder-created", path);

    return true;
  }

  function handleModified(msg) {
    const { path, stat } = msg;

    if (!path || hasLocalChange(path)) {
      return false;
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

    return true;
  }

  function handleDeleted(msg) {
    const { path } = msg;

    if (!path || hasLocalChange(path)) {
      return false;
    }

    if (!metadataCache.has(path)) {
      return false;
    }

    const meta = metadataCache.get(path);
    let removed;

    if (meta && meta.type === "directory") {
      removed = deleteSubtreeExceptUnconfirmed(path);
    } else {
      metadataCache.delete(path);
      removed = [path];
    }

    for (const key of removed) {
      contentCache.invalidate(key);
      fsWatch._dispatch("deleted", key);
    }

    return true;
  }

  let appliedEvents = 0;

  function fromSocket(handler) {
    return (msg) => {
      if (handler(msg)) {
        appliedEvents++;
      }
    };
  }

  wsClient.subscribe("created", fromSocket(handleCreated));
  wsClient.subscribe("folder-created", fromSocket(handleFolderCreated));
  wsClient.subscribe("modified", fromSocket(handleModified));
  wsClient.subscribe("deleted", fromSocket(handleDeleted));

  let treeEtag = null;

  function setTreeEtag(etag) {
    treeEtag = etag;
  }

  // Diffs a full server tree against the cache; each delta goes through the file watcher event handlers.
  function reconcile(tree, pruneMissing = true) {
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

    if (!pruneMissing) {
      return;
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
    const appliedBefore = appliedEvents;
    const sentOpsBefore = sentOpCount();
    let result;

    try {
      result = await transport.fetchTree(treeEtag);
    } catch (e) {
      console.warn("[shim:fs] tree resync failed:", e);
      return;
    }

    if (result.notModified) {
      return;
    }

    treeEtag = result.etag;

    const cacheUnchanged =
      appliedEvents === appliedBefore && sentOpCount() === sentOpsBefore;

    reconcile(result.tree, cacheUnchanged);
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

  const metadataChannel = wsClient.channel(METADATA_CHANNEL);

  metadataChannel.subscribe("revision", (msg) => {
    treeEtag = msg.etag;
  });

  metadataChannel.subscribe("replaced", () => {
    if (resyncTimer) {
      clearTimeout(resyncTimer); // drop the resync queued by the socket's open event
      resyncTimer = null;
    }

    resync();
  });

  function connect(vaultId) {
    wsClient.connect(vaultId);
  }

  function disconnect() {
    wsClient.disconnect();
  }

  return {
    connect,
    disconnect,
    setTreeEtag,
  };
}
