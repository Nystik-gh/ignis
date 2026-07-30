import {
  registerPopupWindow,
  unregisterPopupWindow,
} from "../electron/remote/window.js";
import { showVaultManager } from "../ui-registry.js";

export function installWindowClose() {
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

export function installWindowOpen() {
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
