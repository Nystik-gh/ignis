import { clipboardShim } from "./clipboard.js";
import { shellShim } from "./shell.js";
import { dialogShim } from "./dialog.js";
import { menuShim, menuItemShim } from "./menu.js";
import { appShim } from "./app.js";
import { windowShim, webContentsShim } from "./window.js";
import { themeShim } from "./theme.js";
import { sessionShim } from "./session.js";
import { systemPreferencesShim } from "./system-preferences.js";
import { screenShim } from "./screen.js";
import { nativeImageShim } from "./native-image.js";
import { notificationShim } from "./notification.js";

export const remoteShim = {
  clipboard: clipboardShim,
  shell: shellShim,
  dialog: dialogShim,
  Menu: menuShim,
  MenuItem: menuItemShim,
  app: appShim,
  BrowserWindow: windowShim,
  nativeTheme: themeShim,
  session: sessionShim,
  systemPreferences: systemPreferencesShim,
  screen: screenShim,
  nativeImage: nativeImageShim,
  Notification: notificationShim,

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

  getCurrentWindow() {
    return windowShim._current();
  },

  webContents: webContentsShim,

  getCurrentWebContents() {
    return webContentsShim._current();
  },
};
