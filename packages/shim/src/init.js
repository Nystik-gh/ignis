import { fsShim } from "./fs/index.js";
import { installRequestUrlShim } from "./request-url.js";
import { vaultService } from "@ignis/services";
import { showPluginInstallDialog } from "./ui-registry.js";
import { registerReadTransform } from "./fs/transforms.js";
import {
  resolveWorkspaceName,
  loadPresetIfRequested,
  initWorkspacePatch,
} from "./workspace.js";
import { prefetchVaultContent } from "./fs/indexer-prefetch.js";
import { autoTrustDemoVaults, maybeProvisionDemoVault } from "./demo.js";

function resolveVaultId() {
  const urlParams = new URLSearchParams(window.location.search);
  window.__currentVaultId =
    urlParams.get("vault") || localStorage.getItem("last-vault") || "";
  window.__workspaceName = urlParams.get("workspace") || "";
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

  window.__ignisPlugin = info.ignisPlugin || null;

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
  } catch (e) {
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

function initPluginPrompt() {
  if (
    !window.__ignisPlugin ||
    window.__ignisPlugin.installed ||
    window.__ignisPlugin.prompted
  ) {
    return;
  }

  const vaultId = window.__currentVaultId;

  const observer = new MutationObserver(() => {
    if (document.querySelector(".workspace")) {
      observer.disconnect();
      showPluginInstallDialog(vaultId);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
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

    let text =
      typeof data === "string" ? data : new TextDecoder().decode(data);

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

export function initialize() {
  if (maybeProvisionDemoVault()) {
    return;
  }

  resolveVaultId();
  resolveWorkspaceName();
  loadPresetIfRequested();

  const bootstrap = fetchBootstrap();

  if (bootstrap) {
    applyVaultInfo(bootstrap.vault);
    window.__vaultList = bootstrap.vaultList;
    autoTrustDemoVaults(bootstrap.vaultList);
    applyTree(bootstrap.tree);
    applyCoreSyncGuard(bootstrap.plugins);

    // Race the indexer: batch-fetch text content into ContentCache so
    // Obsidian's startup indexing reads hit the cache instead of the network.
    prefetchVaultContent(
      window.__currentVaultId,
      bootstrap.tree,
      fsShim._contentCache,
    );
  } else {
    initVaultConfigFallback();
    initVaultListFallback();
    initMetadataCacheFallback();
    initCoreSyncGuardFallback();
  }

  installRequestUrlShim();
  initWorkspacePatch();
  initPluginPrompt();
}
