const { setIcon } = require("obsidian");
const generalTab = require("./general-tab");
const serverPluginsTab = require("./server-plugins-tab");

// Tracks our own nav items in the "Ignis Core Plugins" group, keyed by plugin ID.
const ownedNavItems = new Map();

function createNavEl(tab, setting) {
  const nav = document.createElement("div");
  nav.className = "vertical-tab-nav-item tappable";

  if (tab.icon) {
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";

    if (tab.icon.startsWith("<svg") || tab.icon.startsWith("<img")) {
      iconEl.innerHTML = tab.icon;
    } else if (tab.icon.endsWith(".svg") || tab.icon.endsWith(".webp") || tab.icon.endsWith(".png")) {
      iconEl.innerHTML = `<img src="${tab.icon}" class="svg-icon" width="24" height="24" />`;
    } else {
      setIcon(iconEl, tab.icon);
    }

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

  return nav;
}

function createTab(id, name, displayFn, app, icon) {
  const tab = {
    id,
    name,
    icon: icon || null,
    containerEl: createDiv("vertical-tab-content"),
    navEl: null,

    display() {
      this.containerEl.empty();
      displayFn(this.containerEl, app);
    },

    hide() {
      this.containerEl.empty();
    },
  };

  return tab;
}

function createGroup(name) {
  const group = document.createElement("div");
  group.className = "vertical-tab-header-group";

  const title = document.createElement("div");
  title.className = "vertical-tab-header-group-title";
  title.textContent = name;
  group.appendChild(title);

  const items = document.createElement("div");
  items.className = "vertical-tab-header-group-items";
  group.appendChild(items);

  return { group, items };
}

function findGroupByTitle(tabHeadersEl, title) {
  const groups = tabHeadersEl.querySelectorAll(".vertical-tab-header-group");

  for (const g of groups) {
    const t = g.querySelector(".vertical-tab-header-group-title");

    if (t?.textContent === title) {
      return g;
    }
  }

  return null;
}

function hideIgnisFromCommunityPlugins(setting) {
  const cpTab = setting.settingTabs.find((t) => t.id === "community-plugins");

  if (!cpTab || cpTab._ignisPatched) {
    return;
  }

  const origRender = cpTab.renderInstalledPlugin;

  cpTab.renderInstalledPlugin = function (manifest, ...rest) {
    if (manifest.id.startsWith("ignis-")) {
      return;
    }

    return origRender.call(this, manifest, ...rest);
  };

  cpTab._ignisPatched = true;
  cpTab._origRenderInstalledPlugin = origRender;
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

  // Hide any ignis plugin nav items that Obsidian placed here.
  for (const tab of setting.pluginTabs) {
    if (tab.id.startsWith("ignis-") && tab.navEl?.parentElement === items) {
      tab.navEl.style.display = "none";
    }
  }

  // Hide the entire group if no visible items remain.
  const hasVisible = Array.from(items.children).some(
    (el) => el.style.display !== "none",
  );

  communityGroup.style.display = hasVisible ? "" : "none";
}

function addPluginNavItem(pluginId, setting, corePluginsItems) {
  // Find the tab object Obsidian created for this plugin.
  const tab = setting.pluginTabs.find((t) => t.id === pluginId);

  if (!tab) {
    return;
  }

  // Don't add if we already have one for this ID.
  if (ownedNavItems.has(pluginId)) {
    return;
  }

  // Create our own nav item that delegates to Obsidian's tab.
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
  ownedNavItems.set(pluginId, nav);
}

function removePluginNavItem(pluginId) {
  const nav = ownedNavItems.get(pluginId);

  if (nav) {
    nav.remove();
    ownedNavItems.delete(pluginId);
  }
}

function removeExistingIgnisGroups(tabHeadersEl) {
  const groups = tabHeadersEl.querySelectorAll(".vertical-tab-header-group");

  for (const g of groups) {
    const title = g.querySelector(".vertical-tab-header-group-title");

    if (
      title?.textContent === "Ignis" ||
      title?.textContent === "Ignis Core Plugins"
    ) {
      g.remove();
    }
  }
}

function injectIgnisSettings(setting, app) {
  removeExistingIgnisGroups(setting.tabHeadersEl);
  ownedNavItems.clear();

  const ignis = createGroup("Ignis");

  const tabs = [
    createTab("ignis-general", "General", generalTab.display, app, "flame"),
    createTab(
      "ignis-core-plugins",
      "Core plugins",
      serverPluginsTab.display,
      app,
      "blocks",
    ),
  ];

  for (const tab of tabs) {
    tab.navEl = createNavEl(tab, setting);
    ignis.items.appendChild(tab.navEl);
  }

  setting.tabHeadersEl.appendChild(ignis.group);

  const corePlugins = createGroup("Ignis Core Plugins");
  setting.tabHeadersEl.appendChild(corePlugins.group);

  hideIgnisFromCommunityPlugins(setting);

  // Create our own nav items for ignis plugin tabs.
  for (const tab of setting.pluginTabs) {
    if (tab.id.startsWith("ignis-") && tab.id !== "ignis-bridge") {
      addPluginNavItem(tab.id, setting, corePlugins.items);
    }
  }

  hideIgnisNavFromCommunityGroup(setting);
  hideCorePluginsGroupIfEmpty();

  // Watch the community group for changes. When Obsidian adds new ignis
  // plugin nav items (async after enable), hide them and create our own.
  const communityGroup = findGroupByTitle(
    setting.tabHeadersEl,
    "Community plugins",
  );

  if (communityGroup) {
    const observer = new MutationObserver(() => {
      // Re-check for new ignis plugin tabs and create nav items.
      for (const tab of setting.pluginTabs) {
        if (tab.id.startsWith("ignis-") && tab.id !== "ignis-bridge") {
          addPluginNavItem(tab.id, setting, corePlugins.items);
        }
      }

      hideIgnisNavFromCommunityGroup(setting);
      hideCorePluginsGroupIfEmpty();
    });

    observer.observe(communityGroup, { childList: true, subtree: true });

    const cleanupObserver = new MutationObserver(() => {
      if (!setting.tabHeadersEl.isConnected) {
        observer.disconnect();
        cleanupObserver.disconnect();
      }
    });

    cleanupObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
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

  // Get current set of ignis plugin IDs from pluginTabs.
  const activeIds = new Set(
    setting.pluginTabs
      .filter((t) => t.id.startsWith("ignis-") && t.id !== "ignis-bridge")
      .map((t) => t.id),
  );

  // Remove nav items for plugins that are no longer active.
  for (const [id] of ownedNavItems) {
    if (!activeIds.has(id)) {
      removePluginNavItem(id);
    }
  }

  // Add nav items for newly active plugins.
  for (const id of activeIds) {
    addPluginNavItem(id, setting, corePluginsItems);
  }

  hideIgnisNavFromCommunityGroup(setting);
  hideCorePluginsGroupIfEmpty();
}

function hideCorePluginsGroupIfEmpty() {
  for (const [, nav] of ownedNavItems) {
    if (nav.isConnected) {
      const group = nav.closest(".vertical-tab-header-group");

      if (group) {
        group.style.display = "";
      }

      return;
    }
  }

  // No items  -  find and hide the group by walking owned nav items' last known parent,
  // or just search the DOM.
  const groups = document.querySelectorAll(".vertical-tab-header-group");

  for (const g of groups) {
    const title = g.querySelector(".vertical-tab-header-group-title");

    if (title?.textContent === "Ignis Core Plugins") {
      g.style.display = ownedNavItems.size > 0 ? "" : "none";
      break;
    }
  }
}

function patchSettingsModal(plugin) {
  const original = plugin.app.setting.onOpen;
  const app = plugin.app;
  plugin._originalOnOpen = original;

  plugin.app.setting.onOpen = function () {
    original.call(this);
    injectIgnisSettings(this, app);
  };
}

function unpatchSettingsModal(plugin) {
  if (plugin._originalOnOpen) {
    plugin.app.setting.onOpen = plugin._originalOnOpen;
  }

  const cpTab = plugin.app.setting.settingTabs.find(
    (t) => t.id === "community-plugins",
  );

  if (cpTab?._origRenderInstalledPlugin) {
    cpTab.renderInstalledPlugin = cpTab._origRenderInstalledPlugin;
    delete cpTab._origRenderInstalledPlugin;
    delete cpTab._ignisPatched;
  }

  ownedNavItems.clear();
}

window.__ignisReconcilePluginTabs = reconcilePluginTabs;

module.exports = { patchSettingsModal, unpatchSettingsModal, reconcilePluginTabs };
