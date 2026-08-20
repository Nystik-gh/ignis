const { WebSocketServer } = require("ws");
const url = require("url");
const watcher = require("./watcher");

// Null / undefined / empty array means no Origin check.
function toOriginSet(list) {
  return Array.isArray(list) && list.length > 0 ? new Set(list) : null;
}

const HEARTBEAT_INTERVAL_MS = 30000;

// Pings each live client every sweep so the connection stays warm through idle-timeout proxies.
// A client that did not pong since the previous sweep is treated as dead and terminated.
function heartbeatSweep(clients) {
  for (const ws of clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}

function setupWebSocket(server, opts = {}) {
  const { getVaultPath, originAllowlist } = opts;

  if (typeof getVaultPath !== "function") {
    throw new Error("setupWebSocket: opts.getVaultPath is required");
  }

  const originSet = toOriginSet(originAllowlist);

  const wss = new WebSocketServer({ server, path: "/ws" });

  // Global message handlers: type -> handler(msg, ws).
  wss.messageHandlers = new Map();

  // Channel-scoped message handlers: channel -> Map<type, handler>.
  const channelHandlers = new Map();

  // Connected clients per vault, for outbound broadcasts.
  const clientsByVault = new Map();

  // Per-client channel subscriptions, populated by inbound subscribe-channel / unsubscribe-channel messages.
  // The broadcast layer uses this to gate channel-scoped broadcasts to only the clients that asked for them.
  const channelSubsByClient = new WeakMap();

  function clientHasChannel(ws, channelName) {
    return channelSubsByClient.get(ws)?.has(channelName) === true;
  }

  function addClientChannel(ws, channelName) {
    let set = channelSubsByClient.get(ws);

    if (!set) {
      set = new Set();
      channelSubsByClient.set(ws, set);
    }

    set.add(channelName);
  }

  function removeClientChannel(ws, channelName) {
    channelSubsByClient.get(ws)?.delete(channelName);
  }

  wss.broadcastToVault = function (vaultId, message) {
    const clients = clientsByVault.get(vaultId);

    if (!clients) {
      return;
    }

    const payload = JSON.stringify(message);

    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  };

  wss.closeVaultSockets = function (vaultId) {
    const clients = clientsByVault.get(vaultId);

    if (!clients) {
      return;
    }

    for (const ws of Array.from(clients)) {
      ws.close(4002, "Vault changed");
    }
  };

  wss.channel = function (name) {
    return {
      on(type, handler) {
        if (!channelHandlers.has(name)) {
          channelHandlers.set(name, new Map());
        }

        channelHandlers.get(name).set(type, handler);
      },

      off(type) {
        channelHandlers.get(name)?.delete(type);
      },

      // Sends a channel-scoped message only to clients that subscribed to this channel via subscribe-channel.
      broadcastToVault(vaultId, message) {
        const clients = clientsByVault.get(vaultId);

        if (!clients) {
          return;
        }

        const payload = JSON.stringify({ channel: name, ...message });

        for (const ws of clients) {
          if (ws.readyState !== ws.OPEN) {
            continue;
          }

          if (!clientHasChannel(ws, name)) {
            continue;
          }

          ws.send(payload);
        }
      },
    };
  };

  wss.on("connection", (ws, req) => {
    if (originSet) {
      const origin = req.headers.origin;

      if (!origin || !originSet.has(origin)) {
        ws.close(4003, "Origin not allowed");
        return;
      }
    }

    const params = new url.URL(req.url, "http://localhost").searchParams;
    const vaultId = params.get("vault");

    if (!vaultId || !getVaultPath(vaultId)) {
      ws.close(4001, "Invalid or missing vault ID");
      return;
    }

    const vaultPath = getVaultPath(vaultId);
    console.log(`[ws] Client connected to vault: ${vaultId}`);

    // isAlive is reset by each pong; the heartbeat sweep terminates sockets that miss one.
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    if (!clientsByVault.has(vaultId)) {
      clientsByVault.set(vaultId, new Set());
    }

    clientsByVault.get(vaultId).add(ws);

    // Start watching this vault (no-op if already watching)
    watcher.startWatching(vaultId, vaultPath);

    // Per-client listener that forwards file events over WebSocket
    const listener = (event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    };

    watcher.addListener(vaultId, listener);

    // Dispatch incoming messages to registered handlers.
    ws.on("message", (data) => {
      let msg;

      try {
        msg = JSON.parse(data);
      } catch (e) {
        console.warn("[ws] failed to parse incoming message:", e.message);
        return;
      }

      // Built-in channel-subscription tracking. Plugins don't register handlers for these types.
      if (msg.type === "subscribe-channel" && typeof msg.channel === "string") {
        addClientChannel(ws, msg.channel);
        return;
      }

      if (
        msg.type === "unsubscribe-channel" &&
        typeof msg.channel === "string"
      ) {
        removeClientChannel(ws, msg.channel);
        return;
      }

      try {
        if (msg.channel) {
          const handler = channelHandlers.get(msg.channel)?.get(msg.type);

          if (handler) {
            handler(msg, ws);
          }
        } else {
          const handler = wss.messageHandlers.get(msg.type);

          if (handler) {
            handler(msg, ws);
          }
        }
      } catch (e) {
        console.warn(
          `[ws] handler for ${msg.channel ? msg.channel + ":" : ""}${msg.type} threw:`,
          e.message,
        );
      }
    });

    ws.on("error", (e) => {
      console.warn(`[ws] Socket error on vault "${vaultId}":`, e.message);
    });

    ws.on("close", () => {
      console.log(`[ws] Client disconnected from vault: ${vaultId}`);
      watcher.removeListener(vaultId, listener);

      const set = clientsByVault.get(vaultId);

      if (set) {
        set.delete(ws);

        if (set.size === 0) {
          clientsByVault.delete(vaultId);
        }
      }

      channelSubsByClient.delete(ws);
    });
  });

  // Heartbeat keeps sockets alive through idle-timeout proxies, and terminates any that stop responding.
  const heartbeat = setInterval(
    () => heartbeatSweep(wss.clients),
    HEARTBEAT_INTERVAL_MS,
  );
  heartbeat.unref?.();

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

module.exports = { setupWebSocket, heartbeatSweep };
