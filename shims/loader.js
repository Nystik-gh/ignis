import { electronShim } from "./electron/index.js";
import { remoteShim } from "./electron/remote/index.js";
import { fsShim } from "./fs/index.js";
import { pathShim } from "./path.js";
import { urlShim } from "./url.js";
import { cryptoShim } from "./crypto/index.js";
import { processShim } from "./process.js";
import { installRequestUrlShim } from "./request-url.js";
import {
  registerPopupWindow,
  unregisterPopupWindow,
} from "./electron/remote/window.js";
import * as childProcessShim from "./node/child_process.js";
import * as eventsShim from "./node/events.js";
import * as osShim from "./node/os.js";
import * as netShim from "./node/net.js";
import * as httpShim from "./node/http.js";

const DEBUG = true;
const _accessLog = new Map(); // "module.property" -> count

function wrapWithProxy(obj, name) {
  if (!DEBUG || !obj || typeof obj !== "object") {
    return obj;
  }

  return new Proxy(obj, {
    get(target, prop) {
      if (
        typeof prop === "string" &&
        prop !== "then" &&
        prop !== "toJSON" &&
        !prop.startsWith("_")
      ) {
        const key = `${name}.${prop}`;
        _accessLog.set(key, (_accessLog.get(key) || 0) + 1);

        if (!(prop in target)) {
          console.warn(`[shim:MISS] ${key} - property not found on shim`);
        }
      }

      return target[prop];
    },
  });
}

window.__shimLog = function () {
  const sorted = [..._accessLog.entries()].sort((a, b) => b[1] - a[1]);
  console.table(sorted.map(([k, v]) => ({ api: k, calls: v })));
};

window.__shimMisses = function () {
  const sorted = [..._accessLog.entries()]
    .filter(([k]) => {
      const [mod, prop] = k.split(".");
      const shim = rawRegistry[mod];
      return shim && !(prop in shim);
    })
    .sort((a, b) => b[1] - a[1]);

  console.table(sorted.map(([k, v]) => ({ api: k, calls: v })));
};

const rawRegistry = {
  electron: electronShim,
  "@electron/remote": remoteShim,
  "original-fs": fsShim,
  fs: fsShim,
  path: pathShim,
  url: urlShim,
  crypto: cryptoShim,
  child_process: childProcessShim,
  events: eventsShim,
  os: osShim,
  net: netShim,
  http: httpShim,
  https: httpShim,
};

const shimRegistry = {};
for (const [name, shim] of Object.entries(rawRegistry)) {
  shimRegistry[name] = wrapWithProxy(shim, name);
}

const throwOnRequire = new Set(["btime", "get-fonts", "vibrancy-win"]);

window.require = function (moduleName) {
  if (throwOnRequire.has(moduleName)) {
    throw new Error(`Cannot find module '${moduleName}'`);
  }

  if (shimRegistry[moduleName]) {
    return shimRegistry[moduleName];
  }

  console.warn("[ignis] Unshimmed require:", moduleName);
  return wrapWithProxy({}, `UNKNOWN(${moduleName})`);
};

window.process = processShim;

if (typeof window.Buffer === "undefined") {
  window.Buffer = {
    from: function (data, encoding) {
      if (typeof data === "string") {
        return new TextEncoder().encode(data);
      }

      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }

      return new Uint8Array(data);
    },
    concat: function (arrays) {
      const total = arrays.reduce((sum, a) => sum + a.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;

      for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
      }

      return result;
    },
    isBuffer: function (obj) {
      return obj instanceof Uint8Array;
    },
  };
}

window.close = function () {
  console.log("[ignis] window.close() blocked");
};

window.__popupIframe = null;
const _originalOpen = window.open;
window.open = function (url, target, features) {
  if (url === "about:blank" || (features && features.includes("popup"))) {
    console.log("[ignis] intercepted popup:", url, features);

    registerPopupWindow();

    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;left:-9999px;width:0;height:0;border:none;";

    document.body.appendChild(iframe);
    window.__popupIframe = iframe;

    const iframeWin = iframe.contentWindow;

    iframeWin.require = window.require;
    iframeWin.module = window.module;
    iframeWin.Buffer = window.Buffer;
    iframeWin.process = window.process;
    iframeWin.global = iframeWin;
    iframeWin.globalEnhance = window.globalEnhance;

    iframeWin.close = function () {
      unregisterPopupWindow();
      iframe.remove();
      window.__popupIframe = null;
    };

    return iframeWin;
  }
  return _originalOpen.call(window, url, target, features);
};

// hacky fix to prevent browser from showing context menu while allowing obsidian context menu
window.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
    Object.defineProperty(e, "defaultPrevented", { get: () => false });
  },
  true,
);

const _urlParams = new URLSearchParams(window.location.search);
window.__currentVaultId = _urlParams.get("vault") || "";

(function initVaultConfig() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/vault/info" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      const info = JSON.parse(xhr.responseText);

      window.__currentVaultId = info.id;
      window.__obsidianVersion = info.version || "0.0.0";

      window.__vaultConfig = {
        id: info.id,
        path: "/",
      };

      console.log("[ignis] Vault:", window.__vaultConfig);
      console.log("[ignis] Obsidian version:", window.__obsidianVersion);
    } else {
      console.warn("[ignis] No vault found, will show manager");
    }
  } catch (e) {
    console.error("[ignis] Failed to fetch vault config:", e);
  }
})();

(function initVaultList() {
  try {
    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/vault/list", false);
    xhr.send();

    if (xhr.status === 200) {
      window.__vaultList = JSON.parse(xhr.responseText);
    }
  } catch (e) {
    window.__vaultList = [];
  }
})();

(function initMetadataCache() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/fs/tree" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      const tree = JSON.parse(xhr.responseText);

      fsShim._metadataCache.populate(tree);
      fsShim._metadataCache.set("", { type: "directory" });
      fsShim._metadataCache.set("/", { type: "directory" });

      console.log(
        "[ignis] Metadata cache populated:",
        fsShim._metadataCache.size,
        "entries",
      );
    } else {
      console.error("[ignis] Failed to fetch metadata tree:", xhr.status);
    }
  } catch (e) {
    console.error("[ignis] Failed to init metadata cache:", e);
  }
})();

installRequestUrlShim();

console.log("[ignis] Shim loader initialized");
