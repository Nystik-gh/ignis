const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs");

// Per-vault chokidar watchers
// Map<vaultId, { watcher, listeners: Set<fn>, vaultPath }>
const vaultWatchers = new Map();

// Set<fn(vaultId, event)>, fired for events on all vaults
const globalListeners = new Set();

function startWatching(vaultId, vaultPath) {
  if (vaultWatchers.has(vaultId)) {
    return vaultWatchers.get(vaultId);
  }

  const watcher = chokidar.watch(vaultPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
    ignored: [
      /(^|[/\\])\.git([/\\]|$)/, // .git directories
    ],
  });

  const entry = { watcher, listeners: new Set(), vaultPath };

  function emit(type, fullPath, stat) {
    const rel = path.relative(vaultPath, fullPath).replace(/\\/g, "/");

    const event = { type, path: rel };

    if (stat) {
      event.stat = {
        size: stat.size,
        mtime: stat.mtimeMs,
        ctime: stat.ctimeMs,
      };
    }

    for (const fn of entry.listeners) {
      try {
        fn(event);
      } catch (e) {
        console.error("[watcher] Listener error:", e);
      }
    }

    for (const fn of globalListeners) {
      try {
        fn(vaultId, event);
      } catch (e) {
        console.error("[watcher] Global listener error:", e);
      }
    }
  }

  watcher
    .on("add", (fullPath) => {
      try {
        const stat = fs.statSync(fullPath);
        emit("created", fullPath, stat);
      } catch {
        emit("created", fullPath, null);
      }
    })
    .on("change", (fullPath) => {
      try {
        const stat = fs.statSync(fullPath);
        emit("modified", fullPath, stat);
      } catch {
        emit("modified", fullPath, null);
      }
    })
    .on("unlink", (fullPath) => {
      emit("deleted", fullPath, null);
    })
    .on("addDir", (fullPath) => {
      // Skip vault root itself
      if (path.resolve(fullPath) === path.resolve(vaultPath)) return;
      emit("folder-created", fullPath, null);
    })
    .on("unlinkDir", (fullPath) => {
      emit("deleted", fullPath, null);
    })
    .on("error", (err) => {
      console.error(`[watcher] Error on vault "${vaultId}":`, err.message);
    });

  vaultWatchers.set(vaultId, entry);
  console.log(`[watcher] Started watching vault: ${vaultId}`);

  return entry;
}

function stopWatching(vaultId) {
  const entry = vaultWatchers.get(vaultId);

  if (entry) {
    entry.watcher.close();
    entry.listeners.clear();
    vaultWatchers.delete(vaultId);
    console.log(`[watcher] Stopped watching vault: ${vaultId}`);
  }
}

function addGlobalListener(fn) {
  globalListeners.add(fn);
}

function removeGlobalListener(fn) {
  globalListeners.delete(fn);
}

function addListener(vaultId, fn) {
  const entry = vaultWatchers.get(vaultId);

  if (entry) {
    entry.listeners.add(fn);
  }
}

function removeListener(vaultId, fn) {
  const entry = vaultWatchers.get(vaultId);

  if (entry) {
    entry.listeners.delete(fn);

    // Stop watching if no listeners remain
    if (entry.listeners.size === 0) {
      stopWatching(vaultId);
    }
  }
}

module.exports = {
  startWatching,
  stopWatching,
  addListener,
  removeListener,
  addGlobalListener,
  removeGlobalListener,
};
