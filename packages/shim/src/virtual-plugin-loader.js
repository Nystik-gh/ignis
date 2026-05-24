// Capture the obsidian module via a one-shot synthetic plugin so virtual plugins (bridge, future bundled) can require("obsidian").

import { setVirtualFile, removeVirtualFile } from "./fs/virtual-files.js";
import { registerShim } from "./require.js";

const EXTRACTOR_ID = "ignis-obsidian-extractor";
const EXTRACTOR_DIR = ".ignis/virtual/" + EXTRACTOR_ID;
const EXTRACTOR_PATH = EXTRACTOR_DIR + "/main.js";

const EXTRACTOR_SRC = `
const obsidian = require("obsidian");
window.__ignisCapturedObsidian = obsidian;
module.exports = class extends obsidian.Plugin {
  onload() {}
};
`;

const EXTRACTOR_MANIFEST = {
  id: EXTRACTOR_ID,
  name: "Ignis Obsidian Module Extractor",
  version: "0.0.0",
  minAppVersion: "1.0.0",
  description: "Internal: captures the obsidian module for virtual plugins.",
  author: "ignis",
  authorUrl: "",
  isDesktopOnly: false,
  dir: EXTRACTOR_DIR,
};

function waitForApp() {
  return new Promise((resolve) => {
    if (window.app && window.app.plugins && window.app.workspace) {
      return resolve();
    }

    const interval = setInterval(() => {
      if (window.app && window.app.plugins && window.app.workspace) {
        clearInterval(interval);
        resolve();
      }
    }, 20);
  });
}

export async function extractObsidianModule() {
  if (window.__obsidian) {
    return window.__obsidian;
  }

  await waitForApp();

  const plugins = window.app.plugins;

  // loadPlugin gates on isEnabled(). Force-enable, restore on cleanup.
  const wasEnabled = plugins.isEnabled();
  let toggledOn = false;

  if (!wasEnabled) {
    try {
      await plugins.setEnable(true);
      toggledOn = true;
    } catch (e) {
      console.warn(
        "[ignis] could not enable community plugins for extractor:",
        e,
      );
    }
  }

  setVirtualFile(EXTRACTOR_PATH, EXTRACTOR_SRC);
  plugins.manifests[EXTRACTOR_ID] = EXTRACTOR_MANIFEST;

  try {
    await plugins.loadPlugin(EXTRACTOR_ID);
  } catch (e) {
    console.error("[ignis] extractor load failed:", e);
  }

  const captured = window.__ignisCapturedObsidian;

  try {
    await plugins.unloadPlugin(EXTRACTOR_ID);
  } catch {}

  delete plugins.manifests[EXTRACTOR_ID];
  removeVirtualFile(EXTRACTOR_PATH);
  delete window.__ignisCapturedObsidian;

  if (toggledOn) {
    try {
      await plugins.setEnable(false);
    } catch {}
  }

  if (!captured) {
    console.error("[ignis] obsidian module extraction failed");
    return null;
  }

  window.__obsidian = captured;
  registerShim("obsidian", captured);

  console.log("[ignis] obsidian module captured");
  return captured;
}

export async function loadVirtualPlugin(entry) {
  if (entry.cssUrl) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = entry.cssUrl;
    link.setAttribute("data-ignis-virtual-plugin", entry.id);
    document.head.appendChild(link);
  }

  const res = await fetch(entry.scriptUrl);

  if (!res.ok) {
    throw new Error(
      `fetch ${entry.scriptUrl} -> ${res.status} ${res.statusText}`,
    );
  }

  const src =
    (await res.text()) + `\n//# sourceURL=ignis-virtual/${entry.id}.js`;

  const module = { exports: {} };
  const localRequire = (name) =>
    name === "obsidian" ? window.__obsidian : window.require(name);

  new Function("module", "exports", "require", src)(
    module,
    module.exports,
    localRequire,
  );

  const PluginClass = module.exports.default || module.exports;
  const instance = new PluginClass(window.app, entry.manifest);

  await instance.onload();

  window.__ignis.plugins = window.__ignis.plugins || {};
  window.__ignis.plugins[entry.id] = { instance, manifest: entry.manifest };
}
