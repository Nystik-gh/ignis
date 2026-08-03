// Vault-scoped WebSocket client.Single connection per shim instance.
// Multiple consumers attach via subscribe/channel.

const RECONNECT_DELAY_MS = 2000;

export function createWsClient() {
  let ws = null;
  let vaultId = null;
  let reconnectTimer = null;
  let manuallyClosed = false;
  let state = "closed"; // "closed" | "connecting" | "open"

  const globalSubs = new Map(); // type -> Set<handler>
  const channelSubs = new Map(); // channelName -> Map<type, Set<handler>>
  const channelSubCount = new Map(); // channelName -> integer
  const stateSubs = new Set(); // handler(state)
  const openSubs = new Set(); // handler() fired on each socket open

  function setState(next) {
    if (state === next) {
      return;
    }

    state = next;

    for (const fn of stateSubs) {
      try {
        fn(state);
      } catch (e) {
        console.error("[ws] state subscriber threw:", e);
      }
    }
  }

  function postRaw(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function sendSubscribeChannel(name) {
    postRaw({ type: "subscribe-channel", channel: name });
  }

  function sendUnsubscribeChannel(name) {
    postRaw({ type: "unsubscribe-channel", channel: name });
  }

  function dispatch(msg) {
    if (msg.channel) {
      const types = channelSubs.get(msg.channel);
      const handlers = types && types.get(msg.type);

      if (handlers) {
        for (const fn of handlers) {
          try {
            fn(msg);
          } catch (e) {
            console.error(
              `[ws] channel subscriber for ${msg.channel}:${msg.type} threw:`,
              e,
            );
          }
        }
      }

      return;
    }

    const handlers = globalSubs.get(msg.type);

    if (handlers) {
      for (const fn of handlers) {
        try {
          fn(msg);
        } catch (e) {
          console.error(`[ws] subscriber for ${msg.type} threw:`, e);
        }
      }
    }
  }

  function openSocket() {
    if (ws) {
      return;
    }

    setState("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?vault=${encodeURIComponent(vaultId)}`;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.error("[ws] failed to create WebSocket:", e);
      ws = null;
      setState("closed");
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[ws] connected");
      setState("open");

      // Re-establish channel subscriptions on the new connection.
      for (const name of channelSubCount.keys()) {
        sendSubscribeChannel(name);
      }

      for (const fn of openSubs) {
        try {
          fn();
        } catch (e) {
          console.error("[ws] open subscriber threw:", e);
        }
      }
    };

    ws.onmessage = (event) => {
      let msg;

      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error("[ws] failed to parse message:", e);
        return;
      }

      dispatch(msg);
    };

    ws.onclose = () => {
      ws = null;
      setState("closed");

      if (!manuallyClosed) {
        scheduleReconnect();
      }
    };

    ws.onerror = (e) => {
      console.error("[ws] error:", e);
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer || manuallyClosed) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      console.log("[ws] reconnecting...");
      openSocket();
    }, RECONNECT_DELAY_MS);
  }

  function connect(id) {
    if (!id) {
      console.warn("[ws] no vault id; skipping connect");
      return;
    }

    vaultId = id;
    manuallyClosed = false;
    openSocket();
  }

  function disconnect() {
    manuallyClosed = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }

    setState("closed");
  }

  function subscribe(type, handler) {
    if (!globalSubs.has(type)) {
      globalSubs.set(type, new Set());
    }

    globalSubs.get(type).add(handler);

    return () => {
      globalSubs.get(type)?.delete(handler);
    };
  }

  function send(type, payload) {
    postRaw({ type, ...payload });
  }

  function channel(name) {
    return {
      subscribe(type, handler) {
        if (!channelSubs.has(name)) {
          channelSubs.set(name, new Map());
        }

        const types = channelSubs.get(name);

        if (!types.has(type)) {
          types.set(type, new Set());
        }

        types.get(type).add(handler);

        // First subscriber for this channel: upgrade the server-side gate.
        const prevCount = channelSubCount.get(name) || 0;
        channelSubCount.set(name, prevCount + 1);

        if (prevCount === 0) {
          sendSubscribeChannel(name);
        }

        return () => {
          const set = types.get(type);

          if (!set || !set.has(handler)) {
            return;
          }

          set.delete(handler);

          const newCount = (channelSubCount.get(name) || 0) - 1;

          if (newCount <= 0) {
            channelSubCount.delete(name);
            sendUnsubscribeChannel(name);
          } else {
            channelSubCount.set(name, newCount);
          }
        };
      },

      send(type, payload) {
        postRaw({ channel: name, type, ...payload });
      },
    };
  }

  function isOpen() {
    return state === "open";
  }

  function onStateChange(handler) {
    stateSubs.add(handler);

    return () => {
      stateSubs.delete(handler);
    };
  }

  function onOpen(handler) {
    openSubs.add(handler);

    return () => {
      openSubs.delete(handler);
    };
  }

  return {
    connect,
    disconnect,
    subscribe,
    send,
    channel,
    isOpen,
    onStateChange,
    onOpen,
  };
}

// Singleton instance. The shim has one WebSocket per page; consumers all share it.
export const wsClient = createWsClient();
