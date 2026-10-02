import { Platform } from "obsidian";
import * as generalTab from "./general-tab.js";
import * as vaultTab from "./vault-tab.js";
import * as serverPluginsTab from "./server-plugins-tab.js";
import * as serverSettings from "./server-settings.js";
import * as pluginList from "./plugin-list.js";
import { IgnisSettingTab, createNavEl, createGroup } from "./settings-ui.js";
import {
  allIgnisNavEls,
  setupPluginTabs,
  reconcilePluginTabs,
  hideIgnisFromCommunityPlugins,
  restoreCommunityPlugins,
  clearOwnedPluginIds,
  disconnectCommunityObserver,
} from "./plugin-tabs.js";

let ignisTabs = [];

function createIgnisTabs(app) {
  return [
    new IgnisSettingTab(
      app,
      "ignis-general",
      "General",
      "flame",
      generalTab.settingDefinitions,
    ),
    new IgnisSettingTab(
      app,
      "ignis-vault",
      "Vault",
      "vault",
      vaultTab.settingDefinitions,
    ),
    new IgnisSettingTab(
      app,
      "ignis-core-plugins",
      "Core plugins",
      "blocks",
      serverPluginsTab.settingDefinitions,
    ),
  ];
}

function refreshIgnisSettings() {
  for (const store of [serverSettings, pluginList]) {
    store.refresh().then((changed) => {
      if (!changed) {
        return;
      }

      for (const tab of ignisTabs) {
        tab.update();
      }
    });
  }
}

function removeExistingIgnisGroups(setting) {
  const sections = setting.tabHeadersEl.querySelectorAll(
    '[data-section="ignis"], [data-section="ignis-core-plugins"]',
  );

  for (const items of sections) {
    items.closest(".vertical-tab-header-group")?.remove();
  }
}

function writeVersionRow(versionSetting, ignisVersion) {
  const desc = versionSetting.descEl;

  desc.empty();
  desc.createEl("strong", { text: `Running in Ignis v${ignisVersion}` });
  desc.createEl("br");
  desc.appendText(
    "Obsidian is served through Ignis. There's no installer to update.",
  );
}

// Replace the installer version with the Ignis version.
function patchVersionRow(setting, ignisVersion) {
  const aboutTab = setting.settingTabs.find((t) => t.id === "about");

  if (!aboutTab || aboutTab._ignisOriginalUpdateVersionSetting) {
    return;
  }

  const original = aboutTab.updateVersionSetting;
  aboutTab._ignisOriginalUpdateVersionSetting = original;

  aboutTab.updateVersionSetting = function () {
    original.call(this);

    if (this.currentVersionSetting) {
      writeVersionRow(this.currentVersionSetting, ignisVersion);
    }
  };

  if (aboutTab.currentVersionSetting) {
    writeVersionRow(aboutTab.currentVersionSetting, ignisVersion);
  }
}

function unpatchVersionRow(setting) {
  const aboutTab = setting.settingTabs.find((t) => t.id === "about");

  if (aboutTab?._ignisOriginalUpdateVersionSetting) {
    aboutTab.updateVersionSetting = aboutTab._ignisOriginalUpdateVersionSetting;
    delete aboutTab._ignisOriginalUpdateVersionSetting;
  }
}

function patchOpenTab(setting) {
  if (setting._ignisOpenTabPatched) {
    return;
  }

  const original = setting.openTab.bind(setting);
  setting._ignisOriginalOpenTab = original;

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
  };

  setting._ignisOpenTabPatched = true;
}

function injectIgnisSettings(setting, plugin) {
  removeExistingIgnisGroups(setting);
  clearOwnedPluginIds();
  allIgnisNavEls.clear();

  patchOpenTab(setting);
  patchVersionRow(setting, plugin.manifest.version);

  const ignis = createGroup("Ignis", "ignis");

  for (const tab of ignisTabs) {
    tab.navEl = createNavEl(tab, setting);
    ignis.items.appendChild(tab.navEl);
    allIgnisNavEls.set(tab.id, tab.navEl);
  }

  setting.tabGroupContainerEl.appendChild(ignis.group);

  const corePlugins = createGroup("Ignis Core Plugins", "ignis-core-plugins");
  setting.tabGroupContainerEl.appendChild(corePlugins.group);

  hideIgnisFromCommunityPlugins(setting);
  setupPluginTabs(setting, corePlugins.items);

  return ignisTabs;
}

function patchSettingsModal(plugin) {
  const setting = plugin.app.setting;
  const original = setting.onOpen;
  plugin._originalOnOpen = original;

  ignisTabs = createIgnisTabs(plugin.app);

  for (const tab of ignisTabs) {
    tab.update();
    setting.searchIndex.addTab(tab);
  }

  setting.onOpen = function () {
    // read before obsidian overwrites it.
    const lastTabId = this.lastTabId;

    original.call(this);

    const tabs = injectIgnisSettings(this, plugin);
    const lastTab = tabs.find((tab) => tab.id === lastTabId);

    if (lastTab && !Platform.isPhone) {
      this.openTab(lastTab);
    }

    refreshIgnisSettings();
  };
}

function unpatchSettingsModal(plugin) {
  const setting = plugin.app.setting;

  if (plugin._originalOnOpen) {
    setting.onOpen = plugin._originalOnOpen;
  }

  for (const tab of ignisTabs) {
    setting.searchIndex.removeTab(tab);
  }

  ignisTabs = [];
  setting.refreshSearch();

  if (setting._ignisOriginalOpenTab) {
    setting.openTab = setting._ignisOriginalOpenTab;
    delete setting._ignisOriginalOpenTab;
  }

  delete setting._ignisOpenTabPatched;

  unpatchVersionRow(setting);
  restoreCommunityPlugins(setting);
  disconnectCommunityObserver();
  clearOwnedPluginIds();
}

export {
  patchSettingsModal,
  unpatchSettingsModal,
  refreshIgnisSettings,
  reconcilePluginTabs,
};
