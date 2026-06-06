import { Setting, Notice } from "obsidian";
import { reconcilePluginTabs } from "./plugin-tabs.js";

function getVaultId() {
  return window.__currentVaultId || "";
}

async function fetchPlugins() {
  const res = await fetch("/api/plugins");

  if (!res.ok) {
    throw new Error("Failed to fetch plugins");
  }

  return res.json();
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

function display(containerEl, app) {
  containerEl.createEl("h2", { text: "Ignis Core Plugins" });

  containerEl.createEl("p", {
    text:
      "Ignis plugins extend server functionality and run alongside your vaults. " +
      "They are separate from Obsidian's built-in plugins.",
    cls: "ignis-plugins-description",
  });

  const loadingEl = containerEl.createEl("p", { text: "Loading plugins..." });

  fetchPlugins()
    .then((plugins) => {
      loadingEl.remove();

      if (plugins.length === 0) {
        containerEl.createEl("p", {
          text: "No server plugins available.",
          cls: "setting-item-description",
        });
        return;
      }

      const vaultId = getVaultId();

      for (const plugin of plugins) {
        const enabled = plugin.enabledVaults.includes(vaultId);

        new Setting(containerEl)
          .setName(plugin.name)
          .setDesc(plugin.description || "")
          .addToggle((toggle) => {
            toggle.setValue(enabled);
            toggle.onChange(async (value) => {
              try {
                await togglePlugin(plugin.id, value);

                new Notice(
                  `${plugin.name} ${value ? "enabled" : "disabled"} for this vault.`,
                );

                // The server's WS broadcast drives the actual load/unload via virtual-plugin-loader.
                // Reconcile the settings sidebar so the new plugin's settings tab gets grouped correctly.
                setTimeout(() => {
                  reconcilePluginTabs(app.setting);
                }, 100);
              } catch (e) {
                new Notice(`Failed: ${e.message}`);
                toggle.setValue(!value);
              }
            });
          });
      }
    })
    .catch((e) => {
      loadingEl.setText("Failed to load plugins.");
      console.error("[ignis-bridge] Server plugins error:", e);
    });
}

export { display };
