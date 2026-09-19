// Obsidian 1.13.x opens the settings panel in a popout window via window.open().
// Ignis intercepts popup windows as hidden iframes, so the panel renders off-screen
// and clicking the gear appears to do nothing. The settings panel has a
// "settingsPopoutWindow" config toggle: force it off at runtime so the panel opens
// as a regular modal, while preserving whatever the user has on disk.

import {
  registerReadTransform,
  registerWriteTransform,
} from "./fs/transforms.js";
import { fsShim } from "./fs/index.js";

const APP_PATH = ".obsidian/app.json";

// undefined = key absent on disk; write transform keeps it absent.
let preservedPopout = undefined;

function snapshotAppConfig() {
  try {
    const obj = JSON.parse(fsShim.readFileSync(APP_PATH, "utf-8"));

    if ("settingsPopoutWindow" in obj) {
      preservedPopout = obj.settingsPopoutWindow;
    }
  } catch {
    // File missing or malformed; preservedPopout stays undefined.
  }
}

function readTransform(data) {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);

  try {
    const obj = JSON.parse(text);

    // Force the in-browser settings panel to open as a modal, never as a
    // popout window (which the popup iframe interception renders off-screen).
    if (obj.settingsPopoutWindow !== false) {
      obj.settingsPopoutWindow = false;
      return JSON.stringify(obj);
    }
  } catch {}

  return data;
}

function writeTransform(data) {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);

  try {
    const obj = JSON.parse(text);

    if (preservedPopout === undefined) {
      delete obj.settingsPopoutWindow;
    } else {
      obj.settingsPopoutWindow = preservedPopout;
    }

    return JSON.stringify(obj);
  } catch {
    return data;
  }
}

// Keep the config from being persisted at runtime.
function patchSetConfig() {
  const tryPatch = () => {
    const vault = window.app && window.app.vault;

    if (!vault || typeof vault.setConfig !== "function") {
      return false;
    }

    if (vault.__ignisSettingsPopoutGuarded) {
      return true;
    }

    const orig = vault.setConfig.bind(vault);

    vault.setConfig = function (key, value) {
      if (key === "settingsPopoutWindow") {
        return orig("settingsPopoutWindow", false);
      }

      return orig(key, value);
    };
    vault.__ignisSettingsPopoutGuarded = true;

    // Override any platform default (desktop default is true in 1.13.x).
    vault.setConfig("settingsPopoutWindow", false);

    return true;
  };

  if (tryPatch()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (tryPatch()) {
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

export function initSettingsPopoutGuard() {
  snapshotAppConfig();
  registerReadTransform(APP_PATH, readTransform);
  registerWriteTransform(APP_PATH, writeTransform);
  patchSetConfig();
}
