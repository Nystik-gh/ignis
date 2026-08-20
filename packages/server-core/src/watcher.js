const chokidar = require("chokidar");
const path = require("path");

// Idle window before a watcher with no listeners stops.
const IDLE_STOP_MS = 10 * 60 * 1000;

let idleStopMs = IDLE_STOP_MS;

// Per-vault chokidar watchers
// Map<vaultId, { watcher, listeners: Set<fn>, vaultPath, idleTimer, ready, errorCount, firstError, enospc }>
const vaultWatchers = new Map();

// Set<fn(vaultId, event)>, fired for events on all vaults
const globalListeners = new Set();

function cancelIdleStop(entry) {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function countTrackedPaths(watchedDirs) {
  return Object.values(watchedDirs).reduce(
    (acc, names) => acc + names.length,
    0,
  );
}

function startWatching(vaultId, vaultPath) {
  const existing = vaultWatchers.get(vaultId);

  if (existing) {
    cancelIdleStop(existing);

    return existing;
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

  const entry = {
    watcher,
    listeners: new Set(),
    vaultPath,
    idleTimer: null,
    ready: false,
    errorCount: 0,
    firstError: null,
    enospc: false,
  };

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
    .on("add", (fullPath, stats) => {
      emit("created", fullPath, stats || null);
    })
    .on("change", (fullPath, stats) => {
      emit("modified", fullPath, stats || null);
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
      if (entry.ready) {
        console.error(`[watcher] Error on vault "${vaultId}":`, err.message);

        return;
      }

      entry.errorCount++;
      entry.enospc = entry.enospc || err.code === "ENOSPC";

      if (entry.errorCount === 1) {
        entry.firstError = {
          message: err.message,
          code: err.code,
          path: err.path,
        };

        console.error(
          `[watcher] Error on vault "${vaultId}"${err.path ? ` at ${err.path}` : ""}:`,
          err.message,
        );
      }
    })
    .on("ready", () => {
      entry.ready = true;

      const tracked = countTrackedPaths(watcher.getWatched());

      if (entry.errorCount === 0) {
        console.log(
          `[watcher] Ready on vault "${vaultId}": ${tracked} paths tracked`,
        );

        return;
      }

      const hint = entry.enospc ? " Raise fs.inotify.max_user_watches." : "";

      console.warn(
        `[watcher] Ready on vault "${vaultId}": ${tracked} paths tracked, ${entry.errorCount} errors, ~${tracked - entry.errorCount} watched.${hint}`,
      );
    });

  vaultWatchers.set(vaultId, entry);
  entry.idleTimer = setTimeout(() => stopWatching(vaultId), idleStopMs);
  console.log(`[watcher] Started watching vault: ${vaultId}`);

  return entry;
}

function stopWatching(vaultId) {
  const entry = vaultWatchers.get(vaultId);

  if (!entry) {
    return;
  }

  cancelIdleStop(entry);
  entry.listeners.clear();
  vaultWatchers.delete(vaultId);
  console.log(`[watcher] Stopped watching vault: ${vaultId}`);

  return entry.watcher.close().catch((e) => {
    console.error(`[watcher] Close failed on vault "${vaultId}":`, e.message);
  });
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
    cancelIdleStop(entry);
    entry.listeners.add(fn);
  }
}

function removeListener(vaultId, fn) {
  const entry = vaultWatchers.get(vaultId);

  if (entry) {
    entry.listeners.delete(fn);

    if (entry.listeners.size === 0) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = setTimeout(() => stopWatching(vaultId), idleStopMs);
    }
  }
}

// Test-only.
function _setIdleStopMs(ms) {
  idleStopMs = ms ?? IDLE_STOP_MS;
}

function _reset() {
  const closings = [];

  for (const vaultId of vaultWatchers.keys()) {
    closings.push(stopWatching(vaultId));
  }

  globalListeners.clear();

  return Promise.all(closings);
}

module.exports = {
  startWatching,
  stopWatching,
  addListener,
  removeListener,
  addGlobalListener,
  removeGlobalListener,
  _setIdleStopMs,
  _reset,
};
