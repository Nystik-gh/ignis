export const dialogShim = {
  async showOpenDialog(browserWindow, options) {
    // TODO: implement custom modal with server-side file listing
    console.log("[shim:dialog] showOpenDialog (stub):", options);
    return { canceled: true, filePaths: [] };
  },

  // TODO: replace prompt() with a styled modal (matching vault manager style)
  async showSaveDialog(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }
    const defaultName =
      options?.defaultPath?.split(/[/\\]/).pop() || "download";
    const name = prompt("Save as:", defaultName);
    if (!name) {
      return { canceled: true, filePath: undefined };
    }
    return { canceled: false, filePath: "/downloads/" + name };
  },

  // TODO: replace alert() with a styled modal (matching vault manager style)
  async showMessageBox(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }

    console.log("[shim:dialog] showMessageBox:", options);

    const message = options.message || "";
    const detail = options.detail || "";
    const buttons = options.buttons || ["OK"];

    if (buttons.length <= 1) {
      alert(message + (detail ? "\n\n" + detail : ""));
      return { response: 0, checkboxChecked: false };
    }

    const result = confirm(
      message +
        (detail ? "\n\n" + detail : "") +
        '\n\n[OK] = "' +
        buttons[0] +
        '", [Cancel] = "' +
        buttons[1] +
        '"',
    );
    return {
      response: result ? 0 : 1,
      checkboxChecked: false,
    };
  },

  showErrorBox(title, content) {
    console.error("[shim:dialog] Error:", title, content);
    alert(title + "\n\n" + content);
  },
};
