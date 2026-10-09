import { Notice } from "obsidian";
import * as pluginList from "./plugin-list.js";
import { reconcilePluginTabs } from "./plugin-tabs.js";
import { messageDefinition } from "./settings-ui.js";

function getVaultId() {
  return window.__currentVaultId || "";
}

async function togglePlugin(pluginId, enable) {
  const action = enable ? "enable" : "disable";
  const vaultId = getVaultId();

  const res = await fetch(`/api/plugins/${pluginId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault: vaultId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to ${action} plugin`);
  }

  return res.json();
}

function settingDefinitions(tab) {
  return [
    {
      type: "group",
      items: [
        messageDefinition(
          "Ignis plugins extend server functionality and run alongside your vaults. " +
            "They are separate from Obsidian's built-in plugins. " +
            "Enabling a plugin may download required components, which are kept for reuse.",
        ),
      ],
    },
    { type: "group", items: pluginDefinitions(tab) },
  ];
}

function pluginDefinitions(tab) {
  const plugins = pluginList.get();

  if (!plugins) {
    return [
      messageDefinition(
        pluginList.loadFailed()
          ? "Failed to load plugins."
          : "Loading plugins...",
      ),
    ];
  }

  if (plugins.length === 0) {
    return [messageDefinition("No server plugins available.")];
  }

  return plugins.map((plugin) => pluginDefinition(tab, plugin));
}

function isEnabled(plugin) {
  return plugin.enabledVaults.includes(getVaultId());
}

function pluginDefinition(tab, plugin) {
  return {
    name: plugin.name,
    desc: plugin.description || "",
    render: (setting) => {
      setting.addToggle((toggle) => {
        toggle.setValue(isEnabled(plugin));
        toggle.onChange(async (value) => {
          if (value === isEnabled(plugin)) {
            return;
          }

          try {
            await togglePlugin(plugin.id, value);
            pluginList.setEnabled(plugin.id, getVaultId(), value);

            new Notice(
              `${plugin.name} ${value ? "enabled" : "disabled"} for this vault.`,
            );

            // The server's WS broadcast drives the actual load/unload via virtual-plugin-loader.
            // Reconcile the settings sidebar so the new plugin's settings tab gets grouped correctly.
            setTimeout(() => {
              reconcilePluginTabs(tab.app.setting);
            }, 100);
          } catch (e) {
            new Notice(`Failed: ${e.message}`);
            toggle.setValue(!value);
          }
        });
      });
    },
  };
}

export { settingDefinitions };
