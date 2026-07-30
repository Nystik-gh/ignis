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
  installGlobalAlias();
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
