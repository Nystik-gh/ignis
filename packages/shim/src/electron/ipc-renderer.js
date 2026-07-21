import { showVaultManager } from "../ui-registry.js";
import { vaultService } from "@ignis/services";
import { proxyFetch } from "../util/proxy.js";

const listeners = new Map();

const syncHandlers = {
  vault: () => window.__vaultConfig || { id: "default-vault", path: "/" },
  version: () => window.__obsidianVersion || "0.0.0",
  "is-dev": () => false,

  "file-url": () =>
    "/vault-files/" + encodeURIComponent(window.__currentVaultId || "") + "/",

  "disable-update": () => true,
  update: () => "",
  "disable-gpu": () => false,
  frame: () => null,
  "set-icon": () => null,
  "get-icon": () => null,

  relaunch: () => {
    window.location.reload();
    return null;
  },

  starter: () => {
    showVaultManager();
    return null;
  },

  help: () => {
    window.open("https://help.obsidian.md/", "_blank");
    return null;
  },

  sandbox: () => null,

  "copy-asar": () => false,
  "check-update": () => null,

  "vault-list": () => {
    const result = {};

    for (const v of window.__vaultList || []) {
      result[v.id] = {
        path: "/" + v.id,
        ts: Date.now(),
        open: v.id === vaultService.getCurrentVaultId(),
      };
    }

    return result;
  },

  "vault-open": (vaultPath, newWindow) => {
    const id = (vaultPath || "").replace(/^\/+/, "");
    const vault = (window.__vaultList || []).find((v) => v.id === id);

    if (!vault && id) {
      if (!vaultService.createVaultSync(id)) {
        return "Failed to create vault";
      }
    }

    vaultService.openVault(id);

    return true;
  },

  "vault-remove": (vaultPath) => {
    const id = (vaultPath || "").replace(/^\/+/, "");

    return vaultService.deleteVaultSync(id);
  },

  "vault-move": (oldPath, newPath) => {
    return "Moving vaults is not supported in the web version";
  },

  "vault-message": () => null,
  "get-default-vault-path": () => "/My Vault",
  "get-documents-path": () => "/",
  "desktop-dir": () => "/desktop",
  "documents-dir": () => "/documents",
  resources: () => "",
};

async function handleRequestUrl(requestId, request) {
  try {
    const result = await proxyFetch({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      contentType: request.contentType,
    });

    // Electron's e.reply(requestId, data) sends on the requestId channel
    ipcRenderer._emit(requestId, {
      status: result.status,
      headers: result.headers,
      body: result.body,
    });
  } catch (e) {
    ipcRenderer._emit(requestId, {
      error: e.message,
    });
  }
}

export const ipcRenderer = {
  send(channel, ...args) {
    console.log("[shim:ipcRenderer] send:", channel, args);

    if (syncHandlers[channel]) {
      const result = syncHandlers[channel](...args);
      queueMicrotask(() => ipcRenderer._emit(channel, result));
      return;
    }

    if (channel === "context-menu") {
      queueMicrotask(() =>
        ipcRenderer._emit("context-menu", {
          webContentsId: 1,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        }),
      );
      return;
    }

    if (channel === "request-url") {
      const [requestId, request] = args;
      handleRequestUrl(requestId, request);
      return;
    }

    if (channel === "print-to-pdf") {
      const iframe = window.__popupIframe;

      if (iframe) {
        setTimeout(() => {
          iframe.contentWindow.print();
          setTimeout(() => {
            iframe.contentWindow.close();
            ipcRenderer._emit("print-to-pdf", { success: true });
          }, 500);
        }, 200);
      } else {
        window.print();

        queueMicrotask(() => {
          ipcRenderer._emit("print-to-pdf", { success: true });
        });
      }
      return;
    }
  },

  sendSync(channel, ...args) {
    console.log("[shim:ipcRenderer] sendSync:", channel, args);

    if (syncHandlers[channel]) {
      return syncHandlers[channel](...args);
    }

    console.warn("[shim:ipcRenderer] Unhandled sendSync channel:", channel);
    return null;
  },

  on(channel, listener) {
    if (!listeners.has(channel)) {
      listeners.set(channel, []);
    }

    listeners.get(channel).push(listener);

    return ipcRenderer;
  },

  once(channel, listener) {
    const wrapped = (...args) => {
      ipcRenderer.removeListener(channel, wrapped);
      listener(...args);
    };

    return ipcRenderer.on(channel, wrapped);
  },

  removeListener(channel, listener) {
    const arr = listeners.get(channel);
    if (arr) {
      const idx = arr.indexOf(listener);

      if (idx >= 0) {
        arr.splice(idx, 1);
      }
    }

    return ipcRenderer;
  },

  removeAllListeners(channel) {
    if (channel) {
      listeners.delete(channel);
    } else {
      listeners.clear();
    }

    return ipcRenderer;
  },

  _emit(channel, ...args) {
    const arr = listeners.get(channel);

    if (arr) {
      for (const fn of arr) {
        fn({}, ...args);
      }
    }
  },
};
