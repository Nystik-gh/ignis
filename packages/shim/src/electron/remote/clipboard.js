import { getClipboard } from "./native-clipboard.js";
import { execCommandCopy, execCommandCopyHTML } from "../../util/clipboard.js";
import { reportInsecureApi } from "../../util/insecure-api.js";

export const clipboardShim = {
  readText() {
    return "";
  },

  writeText(text) {
    const clip = getClipboard();

    if (!clip) {
      try {
        if (!execCommandCopy(text)) {
          console.warn("[shim:clipboard] execCommand copy failed");
        }
      } catch (e) {
        console.warn("[shim:clipboard] execCommand copy failed:", e);
      }

      return;
    }

    clip.writeText(text).catch((e) => {
      console.warn("[shim:clipboard] writeText failed:", e);
    });
  },

  readHTML() {
    return "";
  },

  writeHTML(html) {
    const clip = getClipboard();

    if (!clip) {
      try {
        if (!execCommandCopyHTML(html, html)) {
          console.warn("[shim:clipboard] execCommand copy failed");
        }
      } catch (e) {
        console.warn("[shim:clipboard] execCommand copy failed:", e);
      }

      return;
    }

    clip
      .write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([html], { type: "text/plain" }),
        }),
      ])
      .catch((e) => {
        console.warn("[shim:clipboard] writeHTML failed:", e);
      });
  },

  readImage() {
    return { isEmpty: () => true, toPNG: () => new Uint8Array(0) };
  },

  writeImage(image) {
    if (!image || image.isEmpty()) {
      return;
    }

    const clip = getClipboard();

    if (!clip) {
      // images can't be copied on insecure origins.
      reportInsecureApi("clipboard.writeImage");
      return;
    }

    const pngData = image.toPNG();

    if (!pngData || pngData.length === 0) {
      return;
    }

    const blob = new Blob([pngData], { type: "image/png" });

    clip.write([new ClipboardItem({ "image/png": blob })]).catch((e) => {
      console.warn("[shim:clipboard] writeImage failed:", e);
    });
  },

  has(format) {
    return false;
  },

  read(format) {
    return "";
  },

  clear() {
    const clip = getClipboard();

    if (!clip) {
      reportInsecureApi("clipboard.clear", { passive: true });
      return;
    }

    clip.writeText("").catch(() => {});
  },
};
