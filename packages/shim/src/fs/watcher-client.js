// Client-side WebSocket file watcher.
// Connects to the server's /ws endpoint, receives file change events,
// updates the metadata/content caches, and dispatches to fs.watch listeners
// so Obsidian's vault picks them up automatically.

import { isRecentLocalOp } from "./echo-guard.js";

const RECONNECT_DELAY = 2000;

export function createWatcherClient(metadataCache, contentCache, fsWatch) {
  let ws = null;
  let vaultId = null;
  let reconnectTimer = null;

  function connect(vault) {
    vaultId = vault;

    if (!vaultId) {
      console.warn("[watcher] No vault ID, skipping WebSocket connection");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?vault=${encodeURIComponent(vaultId)}`;

    try {
      ws = new WebSocket(url);
      window.__ignisWs = ws;
    } catch (e) {
      console.error("[watcher] Failed to create WebSocket:", e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[watcher] Connected to file watcher");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleEvent(msg);
      } catch (e) {
        console.error("[watcher] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      console.log("[watcher] Disconnected");
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error("[watcher] WebSocket error:", e);
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;

      if (vaultId) {
        console.log("[watcher] Reconnecting...");
        connect(vaultId);
      }
    }, RECONNECT_DELAY);
  }

  function handleEvent(msg) {
    // Skip channel-based plugin messages, those are for other listeners
    if (msg.channel) {
      return;
    }

    const { type, path, stat } = msg;

    if (!type || !path) return;

    // Suppress echo from our own operations
    if (isRecentLocalOp(path)) {
      return;
    }

    switch (type) {
      case "created":
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
        break;

      case "folder-created":
        metadataCache.set(path, { type: "directory" });
        fsWatch._dispatch("folder-created", path);
        break;

      case "modified":
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
        break;

      case "deleted":
        metadataCache.delete(path);
        contentCache.invalidate(path);
        fsWatch._dispatch("deleted", path);
        break;

      default:
        console.warn("[watcher] Unknown event type:", type);
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }
  }

  return {
    connect,
    disconnect,
  };
}
