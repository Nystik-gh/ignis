import { setIcon } from "obsidian";
import { findGroupByTitle } from "./settings-ui.js";
import { isIgnisPlugin } from "../plugin-registry.js";

// All ignis-managed nav elements (both Ignis group and Ignis Core Plugins group).
// Shared with inject.js so the openTab patch can manage is-active across all of them.
const allIgnisNavEls = new Map(); // tab id -> nav element

// Tracks which plugin IDs have nav items we created.
const ownedPluginIds = new Set();

function addPluginNavItem(pluginId, setting, corePluginsItems) {
  const tab = setting.pluginTabs.find((t) => t.id === pluginId);

  if (!tab) {
    return;
  }

  if (ownedPluginIds.has(pluginId)) {
    return;
  }

  const nav = document.createElement("div");
  nav.className = "vertical-tab-nav-item tappable";

  if (tab.icon) {
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, tab.icon);
    nav.appendChild(iconEl);
  }

  const title = document.createElement("div");
  title.className = "vertical-tab-nav-item-title";
  title.textContent = tab.name;
  nav.appendChild(title);

  const chevron = document.createElement("div");
  chevron.className = "vertical-tab-nav-item-chevron";
  nav.appendChild(chevron);

  nav.addEventListener("click", () => {
    setting.openTab(tab);
  });

  corePluginsItems.appendChild(nav);
  ownedPluginIds.add(pluginId);
  allIgnisNavEls.set(pluginId, nav);
}

function removePluginNavItem(pluginId) {
  const nav = allIgnisNavEls.get(pluginId);

  if (nav && ownedPluginIds.has(pluginId)) {
    nav.remove();
    ownedPluginIds.delete(pluginId);
    allIgnisNavEls.delete(pluginId);
  }
}

function hideIgnisFromCommunityPlugins(setting) {
  const cpTab = setting.settingTabs.find((t) => t.id === "community-plugins");

  if (!cpTab || cpTab._ignisPatched) {
    return;
  }

  const origRender = cpTab.renderInstalledPlugin;

  cpTab.renderInstalledPlugin = function (manifest, ...rest) {
    if (isIgnisPlugin(manifest.id)) {
      return;
    }

    return origRender.call(this, manifest, ...rest);
  };

  cpTab._ignisPatched = true;
  cpTab._origRenderInstalledPlugin = origRender;
}

function restoreCommunityPlugins(setting) {
  const cpTab = setting.settingTabs.find(
    (t) => t.id === "community-plugins",
  );

  if (cpTab?._origRenderInstalledPlugin) {
    cpTab.renderInstalledPlugin = cpTab._origRenderInstalledPlugin;
    delete cpTab._origRenderInstalledPlugin;
    delete cpTab._ignisPatched;
  }
}

function hideIgnisNavFromCommunityGroup(setting) {
  const communityGroup = findGroupByTitle(
    setting.tabHeadersEl,
    "Community plugins",
  );

  if (!communityGroup) {
    return;
  }

  const items = communityGroup.querySelector(".vertical-tab-header-group-items");

  if (!items) {
    return;
  }

  for (const tab of setting.pluginTabs) {
    if (isIgnisPlugin(tab.id) && tab.navEl?.parentElement === items) {
      tab.navEl.style.display = "none";
    }
  }

  const hasVisible = Array.from(items.children).some(
    (el) => el.style.display !== "none",
  );

  communityGroup.style.display = hasVisible ? "" : "none";
}

function hideCorePluginsGroupIfEmpty() {
  let hasConnected = false;

  for (const id of ownedPluginIds) {
    const nav = allIgnisNavEls.get(id);

    if (nav?.isConnected) {
      hasConnected = true;
      break;
    }
  }

  const groups = document.querySelectorAll(".vertical-tab-header-group");

  for (const g of groups) {
    const title = g.querySelector(".vertical-tab-header-group-title");

    if (title?.textContent === "Ignis Core Plugins") {
      g.style.display = hasConnected ? "" : "none";
      break;
    }
  }
}

function setupPluginTabs(setting, corePluginsItems) {
  for (const tab of setting.pluginTabs) {
    if (isIgnisPlugin(tab.id) && tab.id !== "ignis-bridge") {
      addPluginNavItem(tab.id, setting, corePluginsItems);
    }
  }

  hideIgnisNavFromCommunityGroup(setting);
  hideCorePluginsGroupIfEmpty();

  const communityGroup = findGroupByTitle(
    setting.tabHeadersEl,
    "Community plugins",
  );

  if (communityGroup) {
    const observer = new MutationObserver(() => {
      for (const tab of setting.pluginTabs) {
        if (isIgnisPlugin(tab.id) && tab.id !== "ignis-bridge") {
          addPluginNavItem(tab.id, setting, corePluginsItems);
        }
      }

      hideIgnisNavFromCommunityGroup(setting);
      hideCorePluginsGroupIfEmpty();
    });

    observer.observe(communityGroup, { childList: true, subtree: true });

    const modalEl = setting.tabHeadersEl.closest(".modal");

    if (modalEl && modalEl.parentElement) {
      const cleanupObserver = new MutationObserver(() => {
        if (!setting.tabHeadersEl.isConnected) {
          observer.disconnect();
          cleanupObserver.disconnect();
        }
      });

      cleanupObserver.observe(modalEl.parentElement, {
        childList: true,
      });
    }
  }
}

function reconcilePluginTabs(setting) {
  const corePluginsGroup = findGroupByTitle(
    setting.tabHeadersEl,
    "Ignis Core Plugins",
  );

  if (!corePluginsGroup) {
    return;
  }

  const corePluginsItems = corePluginsGroup.querySelector(
    ".vertical-tab-header-group-items",
  );

  if (!corePluginsItems) {
    return;
  }

  const activeIds = new Set(
    setting.pluginTabs
      .filter((t) => isIgnisPlugin(t.id) && t.id !== "ignis-bridge")
      .map((t) => t.id),
  );

  for (const id of ownedPluginIds) {
    if (!activeIds.has(id)) {
      removePluginNavItem(id);
    }
  }

  for (const id of activeIds) {
    addPluginNavItem(id, setting, corePluginsItems);
  }

  hideIgnisNavFromCommunityGroup(setting);
  hideCorePluginsGroupIfEmpty();
}

function clearOwnedPluginIds() {
  ownedPluginIds.clear();
}

export {
  allIgnisNavEls,
  setupPluginTabs,
  reconcilePluginTabs,
  hideIgnisFromCommunityPlugins,
  restoreCommunityPlugins,
  clearOwnedPluginIds,
};
