import { fsShim } from "./fs/index.js";
import { installRequestUrlShim } from "./request-url.js";
import { vaultService } from "@ignis/services";
import { registerReadTransform } from "./fs/transforms.js";
import {
  resolveWorkspaceName,
  loadPresetIfRequested,
  initWorkspacePatch,
  isValidWorkspaceName,
} from "./workspace.js";
import { prefetchVaultContent } from "./fs/indexer-prefetch.js";
import { setInputCacheLimits } from "./fs/input-cache.js";
import { setDirectFetchHosts } from "./util/url.js";
import { autoTrustDemoVaults, maybeProvisionDemoVault } from "./demo.js";
import { initNativeMenuGuard } from "./native-menu-guard.js";
import { initSpellcheckGuard } from "./spellcheck-guard.js";

let bootstrapVirtualPlugins = [];

// Settings the client must act on come from the bootstrap response and are applied at page load.
// This includes cache sizes, and the hosts the browser fetches directly instead of via the proxy.
// The server owns and enforces the rest.
function applyServerSettings(s) {
  if (!s) {
    return;
  }

  if (Number.isFinite(s.contentCacheBytes)) {
    fsShim._contentCache.setMaxSize(s.contentCacheBytes);
  }

  setInputCacheLimits({ maxSize: s.inputCacheBytes, ttlMs: s.inputCacheTtlMs });
  setDirectFetchHosts(s.directFetchHosts);
}

export function getBootstrapVirtualPlugins() {
  return bootstrapVirtualPlugins;
}

function resolveVaultId() {
  const urlParams = new URLSearchParams(window.location.search);
  window.__currentVaultId =
    urlParams.get("vault") || localStorage.getItem("last-vault") || "";

  const workspace = urlParams.get("workspace") || "";
  window.__workspaceName = isValidWorkspaceName(workspace) ? workspace : "";
}

// Single round-trip bootstrap: vault info + vault list + metadata tree + plugins.
// Returns the parsed response, or null if the call failed (no vault, network error, etc.)
function fetchBootstrap() {
  if (!window.__currentVaultId) {
    return null;
  }

  try {
    const xhr = new XMLHttpRequest();

    xhr.open(
      "GET",
      "/api/bootstrap?vault=" + encodeURIComponent(window.__currentVaultId),
      false,
    );
    xhr.send();

    if (xhr.status === 200) {
      return JSON.parse(xhr.responseText);
    }
  } catch (e) {
    console.warn("[ignis] Bootstrap fetch failed:", e);
  }

  return null;
}

function applyVaultInfo(info) {
  window.__currentVaultId = info.id;
  localStorage.setItem("last-vault", info.id);
  window.__obsidianVersion = info.version || "0.0.0";

  window.__vaultConfig = {
    id: info.id,
    path: "/",
  };

  console.log("[ignis] Vault:", window.__vaultConfig);
  console.log("[ignis] Obsidian version:", window.__obsidianVersion);
}

function applyTree(tree) {
  fsShim._metadataCache.populate(tree);
  fsShim._metadataCache.set("", { type: "directory" });
  fsShim._metadataCache.set("/", { type: "directory" });

  console.log(
    "[ignis] Metadata cache populated:",
    fsShim._metadataCache.size,
    "entries",
  );
}

function initVaultConfigFallback() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/vault/info" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      applyVaultInfo(JSON.parse(xhr.responseText));
    } else {
      console.warn("[ignis] No vault found, will show manager");
    }
  } catch (e) {
    console.error("[ignis] Failed to fetch vault config:", e);
  }
}

function initVaultListFallback() {
  try {
    vaultService.listVaultsSync();
  } catch {
    window.__vaultList = [];
  }
}

function initMetadataCacheFallback() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/fs/tree" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      applyTree(JSON.parse(xhr.responseText));
    } else {
      console.error("[ignis] Failed to fetch metadata tree:", xhr.status);
    }
  } catch (e) {
    console.error("[ignis] Failed to init metadata cache:", e);
  }
}

// if headless sync is active, we transform reads of core-plugins.json to hide the sync setting from Obsidian.
// this prevents headless sync from being disabled as a result of a different device syncing "Active core plugins list".
// i.e ensure Ignis always has sync: false if headless sync is active.
// This may be somewhat overengineered. Could revisit later.
function applyCoreSyncGuard(plugins) {
  const vaultId = window.__currentVaultId;

  if (!vaultId || !plugins) {
    return;
  }

  const headlessSync = plugins.find(
    (p) => p.id === "headless-sync" && p.bundledPluginId,
  );

  if (!headlessSync || !headlessSync.enabledVaults.includes(vaultId)) {
    return;
  }

  console.log(
    "[ignis] Headless sync active for this vault, patching core-plugins.json reads",
  );
  window.__ignisHeadlessSyncActive = true;

  registerReadTransform(".obsidian/core-plugins.json", (data) => {
    if (!window.__ignisHeadlessSyncActive) {
      return data;
    }

    let text = typeof data === "string" ? data : new TextDecoder().decode(data);

    try {
      const config = JSON.parse(text);

      if (config.sync === true) {
        config.sync = false;
        return JSON.stringify(config);
      }
    } catch {}

    return data;
  });
}

function initCoreSyncGuardFallback() {
  const vaultId = window.__currentVaultId;

  if (!vaultId) {
    return;
  }

  try {
    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/plugins", false);
    xhr.send();

    if (xhr.status === 200) {
      applyCoreSyncGuard(JSON.parse(xhr.responseText));
    }
  } catch (e) {
    console.warn("[ignis] Failed to init core sync guard:", e);
  }
}

// Reflect the priority prefetch's byte progress on the boot splash so the awaited slice reads as active rather than hung.
// The splash logo keeps pulsing through a transit stall, when the byte count would otherwise freeze.
function updateBootProgress(received, total) {
  // Once the injector starts appending Obsidian's scripts it owns the splash label, so stop writing progress over it.
  if (window.__ignisBootStarted) {
    return;
  }

  const label = document.getElementById("ignis-status-label");

  if (!label || !total) {
    return;
  }

  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  label.textContent = `Loading plugins... ${mb(received)}/${mb(total)} MB`;
}

// Resolve the active workspace and snapshot the appearance config.
function resolveWorkspaceAndAppearance() {
  resolveWorkspaceName();
  loadPresetIfRequested();
  initNativeMenuGuard();
  initSpellcheckGuard();
}

export function initialize() {
  if (maybeProvisionDemoVault()) {
    window.__ignisBootReady = Promise.resolve();
    return;
  }

  resolveVaultId();

  const bootstrap = fetchBootstrap();

  if (bootstrap) {
    applyVaultInfo(bootstrap.vault);
    window.__vaultList = bootstrap.vaultList;
    autoTrustDemoVaults(bootstrap.vaultList);
    applyTree(bootstrap.tree);
    applyCoreSyncGuard(bootstrap.plugins);
    bootstrapVirtualPlugins = bootstrap.virtualPlugins || [];
    applyServerSettings(bootstrap.settings);

    // Warm the caches before Obsidian boots.
    // The priority slice (configs and plugin entry files) resolves window.__ignisBootReady, which the index.html injector waits on before appending Obsidian's scripts, so Obsidian's early reads hit the cache.
    // The bulk slice streams afterward without blocking boot.
    const { priority } = prefetchVaultContent(
      window.__currentVaultId,
      bootstrap.tree,
      fsShim._contentCache,
      { onProgress: updateBootProgress },
    );

    window.__ignisBooting = true;

    // Chain workspace/appearance resolution onto readiness so its config reads hit the warm priority slice instead of the network.
    window.__ignisBootReady = priority.then(resolveWorkspaceAndAppearance);
  } else {
    initVaultConfigFallback();
    initVaultListFallback();
    initMetadataCacheFallback();
    initCoreSyncGuardFallback();
    // No prefetch on the fallback path, so resolve directly; the reads fall through to the network.
    resolveWorkspaceAndAppearance();
    window.__ignisBootReady = Promise.resolve();
  }

  installRequestUrlShim();
  initWorkspacePatch();
}
