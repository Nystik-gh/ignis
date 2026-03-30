const { Notice } = require("obsidian");
const fs = require("fs");

const CORE_PLUGINS_PATH = ".obsidian/core-plugins.json";

// Reads core-plugins.json via the fs shim. When headless sync is active,
// the shim patches sync: false, so this returns false. When the flag is
// cleared (user action), this returns the real value.
function isCoreSyncEnabled() {
  try {
    const data = fs.readFileSync(CORE_PLUGINS_PATH, "utf-8");
    const config = JSON.parse(data);
    return config.sync === true;
  } catch {
    return false;
  }
}

function showConflictWarning(title, message) {
  if (!window.IgnisUI?.MessageDialog) {
    new Notice(`${title}: ${message}`, 10000);
    return;
  }

  const dialog = new window.IgnisUI.MessageDialog({
    target: document.body,
    props: { title, message },
  });

  dialog.$on("confirm", () => {
    dialog.$destroy();
  });
}

function startCoreSyncGuard(plugin, api, wsListener) {
  const app = plugin.app;
  const vaultId = app.vault.getName();

  // Monkey-patch syncPlugin.enable() to clear the shim flag before
  // Obsidian writes core-plugins.json. This ensures the read transform
  // doesn't block a user-initiated core sync enable.
  const syncPlugin = app.internalPlugins.getPluginById("sync");
  let origEnable = null;

  if (syncPlugin) {
    origEnable = syncPlugin.enable.bind(syncPlugin);

    syncPlugin.enable = function (...args) {
      window.__ignisHeadlessSyncActive = false;
      api.stopSync(vaultId).catch(() => {});
      return origEnable(...args);
    };
  }

  // Watch for core-plugins.json changes via WebSocket.
  let wasEnabled = isCoreSyncEnabled();

  const rawHandler = (msg) => {
    if (msg.type === "modified" && msg.path === CORE_PLUGINS_PATH) {
      handleCoreSyncChange();
    }
  };

  wsListener.onRaw(rawHandler);

  function handleCoreSyncChange() {
    const enabled = isCoreSyncEnabled();

    if (enabled && !wasEnabled) {
      showConflictWarning(
        "Headless Sync Stopped",
        "Obsidian Sync has been enabled. Headless Sync has been automatically " +
          "stopped to avoid conflicts between the two sync methods.\n\n" +
          "To use Headless Sync again, disable Obsidian Sync in Core Plugins.",
      );
    }

    wasEnabled = enabled;
  }

  return {
    cleanup() {
      wsListener.offRaw();

      if (syncPlugin && origEnable) {
        syncPlugin.enable = origEnable;
      }
    },
  };
}

module.exports = {
  isCoreSyncEnabled,
  startCoreSyncGuard,
};
