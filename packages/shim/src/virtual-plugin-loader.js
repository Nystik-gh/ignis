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
  if (window.__ignis.obsidian) {
    return window.__ignis.obsidian;
  }

  await waitForApp();
  // wait for obsidian to handle trust prompt
  await new Promise((resolve) => window.app.workspace.onLayoutReady(resolve));

  const plugins = window.app.plugins;
  // patch to true to load probe in isolation. Leaves Obsidian state alone.
  plugins.isEnabled = () => true;

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

  delete plugins.isEnabled;
  delete plugins.manifests[EXTRACTOR_ID];
  removeVirtualFile(EXTRACTOR_PATH);
  delete window.__ignisCapturedObsidian;

  if (!captured) {
    console.error("[ignis] obsidian module extraction failed");
    return null;
  }

  window.__ignis.obsidian = captured;
  registerShim("obsidian", captured);

  console.log("[ignis] obsidian module captured");
  return captured;
}

function assertSameOrigin(url) {
  if (new URL(url, location.origin).origin !== location.origin) {
    throw new Error(`refusing cross-origin plugin URL: ${url}`);
  }
}

// Serialize per-id load/unload so rapid toggles can't race.
const inFlight = new Map();

function serialized(id, fn) {
  const prev = inFlight.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  inFlight.set(id, next);
  next.finally(() => {
    if (inFlight.get(id) === next) {
      inFlight.delete(id);
    }
  });
  return next;
}

export function loadVirtualPlugin(entry) {
  return serialized(entry.id, async () => {
    window.__ignis.plugins = window.__ignis.plugins || {};

    if (window.__ignis.plugins[entry.id]) {
      console.log(`[ignis] virtual plugin already loaded: ${entry.id}`);
      return;
    }

    assertSameOrigin(entry.scriptUrl);

    if (entry.cssUrl) {
      assertSameOrigin(entry.cssUrl);

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
      name === "obsidian" ? window.__ignis.obsidian : window.require(name);

    new Function("module", "exports", "require", src)(
      module,
      module.exports,
      localRequire,
    );

    const PluginClass = module.exports.default || module.exports;
    const instance = new PluginClass(window.app, entry.manifest);

    // _loaded = true makes instance.unload() walk the Plugin's _register list later.
    // Cleans up addCommand / addStatusBarItem / addRibbonIcon / addSettingTab / registerEvent.
    instance._loaded = true;
    await instance.onload();

    window.__ignis.plugins[entry.id] = { instance, manifest: entry.manifest };

    window.dispatchEvent(
      new CustomEvent("ignis:virtual-plugin-loaded", {
        detail: { id: entry.id },
      }),
    );
  });
}

export function unloadVirtualPlugin(id) {
  return serialized(id, async () => {
    const tracked = window.__ignis?.plugins?.[id];

    if (!tracked) {
      return;
    }

    try {
      await tracked.instance.unload();
    } catch (e) {
      reportUnloadFailure(id, e);
    }

    document
      .querySelectorAll(`link[data-ignis-virtual-plugin="${id}"]`)
      .forEach((el) => el.remove());

    delete window.__ignis.plugins[id];
  });
}

//TODO: move to ignis API object?
function notice(text) {
  try {
    new window.__ignis.obsidian.Notice(text);
  } catch {}
}

export function reportLoadFailure(id, e) {
  console.error(`[ignis] virtual plugin load failed: ${id}`, e);
  notice(`Failed to load plugin '${id}': ${e.message}`);
}

export function reportUnloadFailure(id, e) {
  console.warn(`[ignis] virtual plugin unload failed: ${id}`, e);
  notice(`Failed to unload plugin '${id}': ${e.message}`);
}

export function watchPluginToggles(wsClient) {
  wsClient.subscribe("virtual-plugin-enable", (msg) => {
    if (msg.vault !== window.__currentVaultId) {
      return;
    }

    loadVirtualPlugin(msg.entry).catch((e) =>
      reportLoadFailure(msg.entry?.id, e),
    );
  });

  wsClient.subscribe("virtual-plugin-disable", (msg) => {
    if (msg.vault !== window.__currentVaultId) {
      return;
    }

    unloadVirtualPlugin(msg.id).catch((e) => reportUnloadFailure(msg.id, e));
  });
}
