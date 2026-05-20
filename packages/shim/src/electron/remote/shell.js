export const shellShim = {
  openExternal(url) {
    window.open(url, "_blank");
    return Promise.resolve();
  },

  openPath(filePath) {
    console.log("[shim:shell] openPath (stub):", filePath);
    return Promise.resolve("");
  },

  showItemInFolder(filePath) {
    console.log("[shim:shell] showItemInFolder (stub):", filePath);
  },
};
