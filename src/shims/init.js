import { fsShim } from "./fs/index.js";
import { installRequestUrlShim } from "./request-url.js";
import { vaultService } from "../services/vault-service.js";
import { showPluginInstallDialog } from "../ui/bootstrap.js";
import { registerReadTransform } from "./fs/read-transforms.js";

function resolveVaultId() {
  const urlParams = new URLSearchParams(window.location.search);
  window.__currentVaultId =
    urlParams.get("vault") || localStorage.getItem("last-vault") || "";
}

function initVaultConfig() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/vault/info" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      const info = JSON.parse(xhr.responseText);

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
    } else {
      console.warn("[ignis] No vault found, will show manager");
    }
  } catch (e) {
    console.error("[ignis] Failed to fetch vault config:", e);
  }
}

function initVaultList() {
  try {
    vaultService.listVaultsSync();
  } catch (e) {
    window.__vaultList = [];
  }
}

function initMetadataCache() {
  try {
    const vaultParam = window.__currentVaultId
      ? "?vault=" + encodeURIComponent(window.__currentVaultId)
      : "";

    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/fs/tree" + vaultParam, false);
    xhr.send();

    if (xhr.status === 200) {
      const tree = JSON.parse(xhr.responseText);

      fsShim._metadataCache.populate(tree);
      fsShim._metadataCache.set("", { type: "directory" });
      fsShim._metadataCache.set("/", { type: "directory" });

      console.log(
        "[ignis] Metadata cache populated:",
        fsShim._metadataCache.size,
        "entries",
      );
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
function initCoreSyncGuard() {
  const vaultId = window.__currentVaultId;

  if (!vaultId) {
    return;
  }

  try {
    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/plugins", false);
    xhr.send();

    if (xhr.status !== 200) {
      return;
    }

    const plugins = JSON.parse(xhr.responseText);
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
  } catch (e) {
    console.warn("[ignis] Failed to init core sync guard:", e);
  }
}

export function initialize() {
  resolveVaultId();
  initVaultConfig();
  initVaultList();
  initMetadataCache();
  initCoreSyncGuard();
  installRequestUrlShim();
  initPluginPrompt();
}
