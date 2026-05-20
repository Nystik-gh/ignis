import { processShim } from "./process.js";
import {
  registerPopupWindow,
  unregisterPopupWindow,
} from "./electron/remote/window.js";
import { showVaultManager } from "./ui-registry.js";

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

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 8192;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function isSameOrigin(url) {
  if (
    !url ||
    url.startsWith("/") ||
    url.startsWith("./") ||
    url.startsWith("../")
  ) {
    return true;
  }

  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return true;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return true;
  }
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

    if (isSameOrigin(url)) {
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
    let binary = false;

    if (init?.body && method !== "GET" && method !== "HEAD") {
      if (typeof init.body === "string") {
        body = init.body;
      } else if (init.body instanceof ArrayBuffer) {
        body = arrayBufferToBase64(init.body);
        binary = true;
      } else if (init.body instanceof Uint8Array) {
        body = arrayBufferToBase64(init.body.buffer);
        binary = true;
      } else if (typeof init.body === "object") {
        body = JSON.stringify(init.body);
      } else {
        body = String(init.body);
      }
    }

    console.log("[shim:fetch] Proxying cross-origin:", method, url);

    const proxyRes = await originalFetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method, headers, body, binary }),
    });

    if (!proxyRes.ok) {
      const err = await proxyRes
        .json()
        .catch(() => ({ error: "Proxy request failed" }));
      throw new TypeError(err.error || "Failed to fetch");
    }

    const result = await proxyRes.json();
    const respBody = base64ToArrayBuffer(result.body);

    return new Response(respBody, {
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

export function installGlobals() {
  installProcess();
  installBuffer();
  installFetchShim();
  installWindowClose();
  installWindowOpen();
  installVibrateShim();
  installContextMenuFix();
}
