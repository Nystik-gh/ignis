const config = require("./config");
const { watcher } = require("@ignis/server-core");

let wss = null;

function setWss(w) {
  wss = w;
}

async function withWatcherStopped(vaultId, vaultPath, mutate) {
  const stopping = watcher.stopWatching(vaultId);
  const wasWatching = stopping !== undefined;

  await stopping;

  try {
    return await mutate();
  } catch (e) {
    config.refreshVaults();

    if (wasWatching) {
      try {
        watcher.startWatching(vaultId, vaultPath);
      } catch (err) {
        console.error(
          `[vault] Watcher restore failed for "${vaultId}":`,
          err.message,
        );
      }

      if (wss) {
        wss.closeVaultSockets(vaultId);
      }
    }

    throw e;
  }
}

module.exports = { setWss, withWatcherStopped };
