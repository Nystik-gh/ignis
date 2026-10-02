const { setIcon } = require("obsidian");

const CHANNEL = "plugin:headless-sync";

const TOOLTIP_MAP = {
  running: "Syncing...",
  synced: "Synced",
  stopped: "Sync stopped",
  error: "Sync error",
};

function initSyncStatusBar(plugin) {
  const vaultId = plugin.app.vault.getName();
  const ws = window.__ignis.ws;
  const channel = ws.channel(CHANNEL);

  const item = plugin.addStatusBarItem();
  item.addClass("ignis-sync-statusbar");
  item.style.display = "none";

  const iconEl = item.createEl("span", { cls: "ignis-sync-icon" });
  setIcon(iconEl, "refresh-cw");

  let popoverEl = null;
  let popoverOpen = false;
  let currentStatus = "stopped";
  let outsideClickHandler = null;
  let unsubLog = null;

  function updateState(status, error) {
    currentStatus = status;

    iconEl.className = "ignis-sync-icon";

    if (status === "running") {
      iconEl.addClass("ignis-sync-syncing");
      iconEl.addClass("ignis-sync-spinning");
    } else if (status === "error") {
      iconEl.addClass("ignis-sync-error");
    } else if (status === "stopped") {
      iconEl.addClass("ignis-sync-stopped");
    } else {
      iconEl.addClass("ignis-sync-synced");
    }

    const tooltip = error || TOOLTIP_MAP[status] || status;
    item.setAttribute("aria-label", tooltip);
    item.setAttribute("data-tooltip-position", "top");
  }

  function showPopover(text) {
    if (popoverEl) {
      const span = popoverEl.querySelector(".ignis-sync-popover-filename");

      if (span) {
        span.textContent = text;
      }

      return;
    }

    popoverEl = item.createEl("div", { cls: "ignis-sync-popover" });
    popoverEl.createEl("span", {
      text: text,
      cls: "ignis-sync-popover-filename",
    });

    popoverOpen = true;

    unsubLog = channel.subscribe("sync-log", onLog);

    outsideClickHandler = (e) => {
      if (!item.contains(e.target)) {
        hidePopover();
      }
    };

    setTimeout(() => {
      document.addEventListener("click", outsideClickHandler, true);
    }, 0);
  }

  function hidePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }

    if (outsideClickHandler) {
      document.removeEventListener("click", outsideClickHandler, true);
      outsideClickHandler = null;
    }

    if (unsubLog) {
      unsubLog();
      unsubLog = null;
    }

    popoverOpen = false;
  }

  function truncatePath(path, maxLen) {
    if (path.length <= maxLen) {
      return path;
    }

    return "…" + path.slice(-(maxLen - 1));
  }

  function formatPopoverText(prefix, path) {
    return `${prefix}: ${truncatePath(path, 46 - prefix.length)}`;
  }

  function updatePopoverText(text) {
    if (!popoverOpen) {
      return;
    }

    const span = popoverEl?.querySelector(".ignis-sync-popover-filename");

    if (span) {
      span.textContent = text;
    }
  }

  function extractFileActivity(line) {
    let match = line.match(/^(?:Downloading|Downloaded)\s+(.+)$/);

    if (match) {
      return { prefix: "Syncing", path: match[1].trim() };
    }

    match = line.match(/^(?:Uploading file|Upload complete|New file)\s+(.+)$/);

    if (match) {
      return { prefix: "Syncing", path: match[1].trim() };
    }

    match = line.match(/^Deleting\s+(.+)$/);

    if (match) {
      return { prefix: "Deleting", path: match[1].trim() };
    }

    match = line.match(/^Push:\s+(.+?)\s+\(updated\)$/);

    if (match) {
      return { prefix: "Syncing", path: match[1].trim() };
    }

    match = line.match(/^Push:\s+(.+?)\s+\(deleted\)$/);

    if (match) {
      return { prefix: "Deleting", path: match[1].trim() };
    }

    return null;
  }

  function isFullySynced(line) {
    return /Fully synced/i.test(line);
  }

  item.addEventListener("click", () => {
    if (popoverOpen) {
      hidePopover();
    } else {
      showPopover(TOOLTIP_MAP[currentStatus] || currentStatus);
    }
  });

  function showVaultState(vault) {
    if (vault.status === "running") {
      updateState("synced");
    } else {
      updateState(vault.status, vault.error);
    }
  }

  const onStatus = (msg) => {
    const payload = msg.payload || {};

    if (payload.vaultId !== vaultId) {
      return;
    }

    plugin.setVaultState(payload);
    item.style.display = "";
    showVaultState(payload);
  };

  const unsubStatus = channel.subscribe("sync-status", onStatus);

  let syncedTimer = null;

  function deferSynced() {
    if (syncedTimer) {
      clearTimeout(syncedTimer);
    }

    syncedTimer = setTimeout(() => {
      syncedTimer = null;
      updateState("synced");
      updatePopoverText("Synced");
    }, 2000);
  }

  function cancelDeferredSynced() {
    if (syncedTimer) {
      clearTimeout(syncedTimer);
      syncedTimer = null;
    }
  }

  function onLog(msg) {
    const payload = msg.payload || {};

    if (payload.vaultId !== vaultId) {
      return;
    }

    if (isFullySynced(payload.line)) {
      deferSynced();
      return;
    }

    const activity = extractFileActivity(payload.line);

    if (activity) {
      cancelDeferredSynced();
      updateState("running");
      updatePopoverText(formatPopoverText(activity.prefix, activity.path));
    }
  }

  plugin.loadVaults().then((vaults) => {
    const vault = vaults?.find((v) => v.vaultId === vaultId);

    if (vault) {
      item.style.display = "";
      showVaultState(vault);
    }
  });

  // Reflect WebSocket disconnect/reconnect in the indicator.
  let wasDisconnected = false;

  const unsubState = ws.onStateChange((state) => {
    const open = state === "open";

    if (!open && (currentStatus === "running" || currentStatus === "synced")) {
      cancelDeferredSynced();
      updateState("error", "Server connection lost");
      wasDisconnected = true;
    } else if (open && wasDisconnected) {
      wasDisconnected = false;

      plugin.loadVaults().then((vaults) => {
        const vault = vaults?.find((v) => v.vaultId === vaultId);

        if (vault) {
          showVaultState(vault);
        }
      });
    }
  });

  return () => {
    cancelDeferredSynced();
    unsubStatus();
    unsubState();
    hidePopover();
  };
}

module.exports = { initSyncStatusBar };
