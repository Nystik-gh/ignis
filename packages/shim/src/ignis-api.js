// Public Ignis API surface. The documented way for plugins (and Ignis-internal code) to reach shim services.
// WIP, may expand to cover more shared functionality.

export function installIgnisApi(wsClient, writes) {
  window.__ignis = window.__ignis || {};

  // Live getters so vault info reflects whatever init.js / vault-switch code has set.
  Object.defineProperty(window.__ignis, "vault", {
    get() {
      return {
        id: window.__currentVaultId || null,
        path: window.__vaultConfig?.path || null,
      };
    },
    enumerable: true,
    configurable: true,
  });

  window.__ignis.ws = {
    subscribe: wsClient.subscribe,
    send: wsClient.send,
    channel: wsClient.channel,
    isOpen: wsClient.isOpen,
    onStateChange: wsClient.onStateChange,
  };

  window.__ignis.writes = writes;

  window.__ignis.plugins = window.__ignis.plugins || {};
}
