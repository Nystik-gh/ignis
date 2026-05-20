import { ipcRenderer } from "./ipc-renderer.js";
import { webFrame } from "./web-frame.js";
import { remoteShim } from "./remote/index.js";
import { nativeImageShim } from "./remote/native-image.js";
import { clipboardShim } from "./remote/clipboard.js";

export const electronShim = {
  ipcRenderer,
  webFrame,
  remote: remoteShim,
  nativeImage: nativeImageShim,
  clipboard: clipboardShim,

  safeStorage: {
    isEncryptionAvailable() {
      return false;
    },
    encryptString(plainText) {
      return Buffer.from(plainText);
    },
    decryptString(encrypted) {
      return encrypted.toString();
    },
  },

  webUtils: {
    getPathForFile(file) {
      return "";
    },
  },

  deprecate: {
    function(fn, name) {
      return fn;
    },
    event(emitter, name) {},
    removeFunction(fn, name) {
      return fn;
    },
    log(message) {
      console.log("[electron:deprecate]", message);
    },
    warn(oldName, newName) {},
    promisify(fn) {
      return fn;
    },
    renameFunction(fn, newName) {
      return fn;
    },
  },
};
