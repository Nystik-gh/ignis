import { processShim } from "./process.js";
import {
  registerPopupWindow,
  unregisterPopupWindow,
} from "./electron/remote/window.js";
import { showVaultManager } from "./ui-registry.js";
import { isSameOrigin, isDirectFetchHost } from "./util/url.js";
import { proxyFetch } from "./util/proxy.js";

function installProcess() {
  window.process = processShim;
}

function installBuffer() {
  if (typeof window.Buffer !== "undefined") return;

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
    alloc: function (size, fill, encoding) {
      const buf = new Uint8Array(size);

      if (fill !== undefined) {
        buf.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill);
      }

      return buf;
    },
    allocUnsafe: function (size) {
      return new Uint8Array(size);
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
    byteLength: function (str, encoding) {
      return new TextEncoder().encode(str).length;
    },
    isEncoding: function (encoding) {
      return [
        "utf8",
        "utf-8",
        "ascii",
        "binary",
        "base64",
        "hex",
        "latin1",
      ].includes((encoding || "").toLowerCase());
    },
  };
}

function installWindowClose() {
  window.close = function () {
    console.log("[ignis] window.close() blocked");

    // Obsidian's quit flow shows the progress overlay, awaits its pending save work, then calls window.close().
    // Since we don't actually want to close the window, we clean up the progress state instead.
    if (document.body.classList.contains("in-progress")) {
      document.querySelector(".progress-bar-container")?.remove();
      document.body.classList.remove("in-progress");
      return;
    }

    if (!window.__vaultConfig) {
      showVaultManager();
    }
  };
}

function installWindowOpen() {
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
}

function installFetchShim() {
  const originalFetch = window.fetch.bind(window);
  window.__originalFetch = originalFetch;

  window.fetch = async function (input, init) {
    let url;

    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    if (isSameOrigin(url) || isDirectFetchHost(url)) {
      return originalFetch(input, init);
    }

    // Cross-origin  -  route through server proxy
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const headers = {};

    if (init?.headers) {
      const h =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers);
      h.forEach((val, key) => {
        headers[key] = val;
      });
    } else if (input instanceof Request) {
      input.headers.forEach((val, key) => {
        headers[key] = val;
      });
    }

    // Mimic the real Obsidian desktop app headers for cross-origin requests
    if (!headers["user-agent"] && !headers["User-Agent"]) {
      headers["user-agent"] = navigator.userAgent;
    }
    if (!headers["origin"] && !headers["Origin"]) {
      headers["origin"] = "app://obsidian.md";
    }

    let body = null;

    if (init?.body && method !== "GET" && method !== "HEAD") {
      if (typeof init.body === "string") {
        body = init.body;
      } else if (
        init.body instanceof ArrayBuffer ||
        init.body instanceof Uint8Array
      ) {
        body = init.body;
      } else if (typeof init.body === "object") {
        body = JSON.stringify(init.body);
      } else {
        body = String(init.body);
      }
    }

    console.log("[shim:fetch] Proxying cross-origin:", method, url);

    let result;

    try {
      result = await proxyFetch({ url, method, headers, body });
    } catch (e) {
      throw new TypeError(e.message || "Failed to fetch");
    }

    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}

function installVibrateShim() {
  if (typeof navigator.vibrate === "function") {
    return;
  }

  // Some Firefox configurations leave navigator.vibrate undefined (gated by dom.vibrator.enabled).
  // Obsidian assumes it's always callable, so provide a no-op where it's missing.
  try {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: () => true,
    });
  } catch {}
}

function installQueryLocalFontsShim() {
  const native =
    typeof window.queryLocalFonts === "function"
      ? window.queryLocalFonts.bind(window)
      : null;

  try {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => (native ? native().catch(() => []) : Promise.resolve([])),
    });
  } catch {}
}

function installContextMenuFix() {
  // hacky fix to prevent browser from showing context menu while allowing obsidian context menu
  window.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      Object.defineProperty(e, "defaultPrevented", { get: () => false });
    },
    true,
  );
}

function installGlobalAlias() {
  window.global = window;
}

export function installGlobals() {
  installGlobalAlias();
  installProcess();
  installBuffer();
  installFetchShim();
  installWindowClose();
  installWindowOpen();
  installVibrateShim();
  installQueryLocalFontsShim();
  installContextMenuFix();
}
