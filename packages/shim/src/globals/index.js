import { processShim } from "../process.js";
import { installBuffer } from "./buffer.js";
import { installFetchShim } from "./fetch.js";
import { installWindowClose, installWindowOpen } from "./window.js";
import {
  installVibrateShim,
  installQueryLocalFontsShim,
  installRandomUUIDShim,
  installClipboardShim,
  installMediaDevicesShim,
  installSubtleShim,
} from "./web-apis.js";

function installProcess() {
  window.process = processShim;
}

function installGlobalAlias() {
  window.global = window;
}

const RENDERER_DIR = "/opt/Obsidian/resources/electron.asar/renderer";

function installDirnameAndFilename() {
  window.__dirname = RENDERER_DIR;
  window.__filename = `${RENDERER_DIR}/init.js`;
}

function installContextMenuFix() {
  // hacky fix to prevent browser from showing context menu while allowing obsidian context menu
  window.addEventListener(
    "contextmenu",
    (e) => {
      const isTouch =
        e.pointerType === "touch" || e.sourceCapabilities?.firesTouchEvents;

      // allow for touch events. Fixes copy/paste on mobile devices.
      if (isTouch) {
        return;
      }

      e.preventDefault();
      Object.defineProperty(e, "defaultPrevented", { get: () => false });
    },
    true,
  );
}

export function installGlobals() {
  installGlobalAlias();
  installDirnameAndFilename();
  installProcess();
  installBuffer();
  installFetchShim();
  installWindowClose();
  installWindowOpen();
  installVibrateShim();
  installQueryLocalFontsShim();
  installRandomUUIDShim();
  installClipboardShim();
  installMediaDevicesShim();
  installSubtleShim();
  installContextMenuFix();
}
