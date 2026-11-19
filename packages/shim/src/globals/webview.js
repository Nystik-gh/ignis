import { MAIN_WEB_CONTENTS_ID } from "../electron/remote/window.js";

const SANDBOX =
  "allow-forms allow-presentation allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox";

const LOAD_EVENTS = ["dom-ready", "did-finish-load", "did-stop-loading"];

export function installWebview() {
  const createElement = Document.prototype.createElement;

  Document.prototype.createElement = function (tagName) {
    if (typeof tagName === "string" && tagName.toLowerCase() === "webview") {
      return createWebview(createElement.call(this, "iframe"));
    }

    return createElement.apply(this, arguments);
  };
}

function createWebview(iframe) {
  const nativeSetAttribute = iframe.setAttribute;
  const srcDescriptor = findDescriptor(iframe, "src");
  let loading = false;
  let zoomFactor = 1;

  const setSrc = (url) => {
    // Loads the src sandboxed.
    nativeSetAttribute.call(iframe, "sandbox", sandboxFor(url));
    loading = true;
    srcDescriptor.set.call(iframe, url);
  };

  nativeSetAttribute.call(iframe, "sandbox", SANDBOX);
  nativeSetAttribute.call(iframe, "allow", "fullscreen");
  iframe.classList.add("ignis-webview");

  Object.defineProperty(iframe, "src", {
    configurable: true,
    get() {
      return srcDescriptor.get.call(iframe);
    },
    set: setSrc,
  });

  iframe.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === "src") {
      setSrc(value);

      return;
    }

    nativeSetAttribute.call(iframe, name, value);
  };

  iframe.addEventListener("load", () => {
    loading = false;

    for (const name of LOAD_EVENTS) {
      iframe.dispatchEvent(new Event(name));
    }
  });

  Object.assign(iframe, {
    loadURL(url) {
      return new Promise((resolve) => {
        iframe.addEventListener("load", () => resolve(), { once: true });
        iframe.src = url;
      });
    },

    reload() {
      const url = iframe.src;

      iframe.src = url;
    },

    isLoading() {
      return loading;
    },

    getZoomFactor() {
      return zoomFactor;
    },

    setZoomFactor(factor) {
      zoomFactor = factor;
      iframe.style.zoom = String(factor);
    },

    getWebContentsId() {
      return MAIN_WEB_CONTENTS_ID;
    },

    getTitle() {
      try {
        return new URL(iframe.src).hostname;
      } catch {
        return "";
      }
    },

    executeJavaScript() {
      return Promise.resolve(undefined);
    },

    insertCSS() {
      return Promise.resolve(undefined);
    },

    stop() {},
    findInPage() {},
    stopFindInPage() {},
  });

  return iframe;
}

function sandboxFor(url) {
  return isOtherWebOrigin(url) ? `${SANDBOX} allow-same-origin` : SANDBOX;
}

function isOtherWebOrigin(url) {
  try {
    const target = new URL(url, location.href);

    return (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.origin !== location.origin
    );
  } catch {
    return false;
  }
}

function findDescriptor(object, key) {
  let proto = Object.getPrototypeOf(object);

  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);

    if (descriptor) {
      return descriptor;
    }

    proto = Object.getPrototypeOf(proto);
  }

  return null;
}
