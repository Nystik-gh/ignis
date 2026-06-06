import { installRequire } from "./require.js";
import { installGlobals } from "./globals.js";
import { installCssOverrides } from "./css-overrides.js";
import { initialize, getBootstrapVirtualPlugins } from "./init.js";
import { fsShim } from "./fs/index.js";
import { registerUI } from "./ui-registry.js";
import {
  extractObsidianModule,
  loadVirtualPlugin,
  reportLoadFailure,
  watchPluginToggles,
} from "./virtual-plugin-loader.js";
import { wsClient } from "./ws-client.js";
import { installIgnisApi } from "./ignis-api.js";

// __IGNIS_VERSION__ (semver) and __IGNIS_BUILD__ are replaced at build time.
window.__ignis = { version: __IGNIS_VERSION__, build: __IGNIS_BUILD__ };
window.__ignis_registerUI = registerUI;

installIgnisApi(wsClient);

const BRIDGE_MANIFEST = {
  id: "ignis-bridge",
  name: "Ignis Bridge",
  version: __IGNIS_VERSION__,
  minAppVersion: "1.12.4",
  description:
    "Additional Ignis specific functionality and ignis plugin management.",
  author: "Nystik",
  authorUrl: "https://github.com/Nystik-gh/ignis",
  isDesktopOnly: false,
};

installGlobals(); // process, Buffer, window overrides (before require so Buffer is available)
installRequire(); // shim registry, window.require
installCssOverrides(); // browser-specific CSS fixes

// Set EmulateMobile flag for small viewports so Obsidian activates its mobile UI
if (window.innerWidth < 600) {
  localStorage.setItem("EmulateMobile", "true");
} else {
  localStorage.removeItem("EmulateMobile");
}

initialize(); // vault config, metadata cache, plugin prompt

// Connect the shared WebSocket after everything is initialized; watcher and live-toggle subscribers attach to the same client.
if (window.__currentVaultId) {
  fsShim._watcherClient.connect(window.__currentVaultId);
  watchPluginToggles(wsClient);
}

extractObsidianModule()
  .then(async () => {
    // Dynamic import so the bridge's top-level obsidian import resolves after installRequire + extractObsidianModule.
    const mod = await import("@ignis/bridge");
    const IgnisBridgePlugin = mod.default || mod;
    const bridge = new IgnisBridgePlugin(window.app, BRIDGE_MANIFEST);
    await bridge.onload();
    console.log("[ignis] bridge loaded");

    for (const vp of getBootstrapVirtualPlugins()) {
      try {
        await loadVirtualPlugin(vp);
        console.log(`[ignis] virtual plugin loaded: ${vp.id}`);
      } catch (e) {
        reportLoadFailure(vp.id, e);
      }
    }
  })
  .catch((e) => console.error("[ignis] bridge load failed:", e));

console.log("[ignis] Shim loader initialized");
