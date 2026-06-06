import * as generalTab from "./general-tab.js";
import * as serverPluginsTab from "./server-plugins-tab.js";
import { createNavEl, createTab, createGroup } from "./settings-ui.js";
import {
  allIgnisNavEls,
  setupPluginTabs,
  reconcilePluginTabs,
  hideIgnisFromCommunityPlugins,
  restoreCommunityPlugins,
  clearOwnedPluginIds,
} from "./plugin-tabs.js";

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

function replaceInstallerVersionRow(setting, ignisVersion) {
  const container = setting.tabContentContainer || setting.contentEl;

  if (!container) {
    return;
  }

  const rows = container.querySelectorAll(".setting-item");

  for (const row of rows) {
    const desc = row.querySelector(".setting-item-description");

    if (!desc || !desc.textContent.startsWith("Installer version:")) {
      continue;
    }

    desc.empty();
    desc.createEl("strong", { text: `Running in Ignis v${ignisVersion}` });
    desc.createEl("br");
    desc.appendText(
      "Obsidian is served through Ignis. There's no installer to update.",
    );
    break;
  }
}

function patchOpenTab(setting, plugin) {
  if (setting._ignisOpenTabPatched) {
    return;
  }

  const original = setting.openTab.bind(setting);

  setting.openTab = function (tab) {
    // Clear is-active from all ignis nav items.
    for (const [, el] of allIgnisNavEls) {
      el.removeClass("is-active");
    }

    original(tab);

    // If the opened tab is one of ours, highlight it.
    const navEl = allIgnisNavEls.get(tab.id);

    if (navEl) {
      navEl.addClass("is-active");
    }

    if (tab && tab.id === "about") {
      replaceInstallerVersionRow(setting, plugin.manifest.version);
    }
  };

  setting._ignisOpenTabPatched = true;
}

function injectIgnisSettings(setting, app, plugin) {
  removeExistingIgnisGroups(setting.tabHeadersEl);
  clearOwnedPluginIds();
  allIgnisNavEls.clear();

  patchOpenTab(setting, plugin);
  replaceInstallerVersionRow(setting, plugin.manifest.version);

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
    allIgnisNavEls.set(tab.id, tab.navEl);
  }

  setting.tabHeadersEl.appendChild(ignis.group);

  const corePlugins = createGroup("Ignis Core Plugins");
  setting.tabHeadersEl.appendChild(corePlugins.group);

  hideIgnisFromCommunityPlugins(setting);
  setupPluginTabs(setting, corePlugins.items);
}

function patchSettingsModal(plugin) {
  const original = plugin.app.setting.onOpen;
  const app = plugin.app;
  plugin._originalOnOpen = original;

  plugin.app.setting.onOpen = function () {
    original.call(this);
    injectIgnisSettings(this, app, plugin);
  };
}

function unpatchSettingsModal(plugin) {
  if (plugin._originalOnOpen) {
    plugin.app.setting.onOpen = plugin._originalOnOpen;
  }

  delete plugin.app.setting._ignisOpenTabPatched;

  restoreCommunityPlugins(plugin.app.setting);
  clearOwnedPluginIds();
}

export { patchSettingsModal, unpatchSettingsModal, reconcilePluginTabs };
