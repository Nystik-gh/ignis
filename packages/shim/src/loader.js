import { installRequire } from "./require.js";
import { installGlobals } from "./globals.js";
import { installCssOverrides } from "./css-overrides.js";
import { initialize } from "./init.js";
import { fsShim } from "./fs/index.js";
import { registerUI } from "./ui-registry.js";

// __IGNIS_VERSION__ is replaced at build time from package.json.
window.__ignis = { version: __IGNIS_VERSION__ };
window.__ignis_registerUI = registerUI;

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

console.log("[ignis] Shim loader initialized");
