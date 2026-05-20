export const clipboardShim = {
  readText() {
    return "";
  },

  writeText(text) {
    navigator.clipboard.writeText(text).catch((e) => {
      console.warn("[shim:clipboard] writeText failed:", e);
    });
  },

  readHTML() {
    return "";
  },

  writeHTML(html) {
    navigator.clipboard
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

    const pngData = image.toPNG();

    if (!pngData || pngData.length === 0) {
      return;
    }

    const blob = new Blob([pngData], { type: "image/png" });

    navigator.clipboard
      .write([new ClipboardItem({ "image/png": blob })])
      .catch((e) => {
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
    navigator.clipboard.writeText("").catch(() => {});
  },
};
