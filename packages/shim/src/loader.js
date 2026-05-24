import { installRequire } from "./require.js";
import { installGlobals } from "./globals.js";
import { installCssOverrides } from "./css-overrides.js";
import { initialize } from "./init.js";
import { fsShim } from "./fs/index.js";
import { registerUI } from "./ui-registry.js";
import {
  extractObsidianModule,
  loadVirtualPlugin,
} from "./virtual-plugin-loader.js";

// __IGNIS_VERSION__ is replaced at build time from package.json.
window.__ignis = { version: __IGNIS_VERSION__ };
window.__ignis_registerUI = registerUI;

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

// Connect file watcher WebSocket after everything is initialized
if (window.__currentVaultId) {
  fsShim._watcherClient.connect(window.__currentVaultId);
}

extractObsidianModule()
  .then(async () => {
    // Dynamic import so bridge's top-level require("obsidian") fires after installRequire + extractObsidianModule.
    const mod = await import("@ignis/bridge");
    const IgnisBridgePlugin = mod.default || mod;
    const bridge = new IgnisBridgePlugin(window.app, BRIDGE_MANIFEST);
    await bridge.onload();
    console.log("[ignis] bridge loaded");

    for (const vp of window.__ignisVirtualPlugins || []) {
      try {
        await loadVirtualPlugin(vp);
        console.log(`[ignis] virtual plugin loaded: ${vp.id}`);
      } catch (e) {
        console.error(`[ignis] virtual plugin load failed: ${vp.id}`, e);
      }
    }
  })
  .catch((e) => console.error("[ignis] bridge load failed:", e));

console.log("[ignis] Shim loader initialized");
