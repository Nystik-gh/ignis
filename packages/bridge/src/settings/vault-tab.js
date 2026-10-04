import { vaultService } from "@ignis/services";
import * as serverSettings from "./server-settings.js";
import { messageDefinition } from "./settings-ui.js";

function settingDefinitions() {
  return [
    {
      type: "group",
      items: [
        messageDefinition(
          "Settings for the currently active vault. " +
            "These settings are not stored in the vault itself, unlike Obsidian's native settings; they apply to all browsers and devices that open this vault.",
        ),
      ],
    },
    { type: "group", items: [vaultSettingDefinition()] },
  ];
}

function vaultSettingDefinition() {
  if (!serverSettings.get()) {
    return messageDefinition(
      serverSettings.loadFailed()
        ? "Failed to load server settings."
        : "Loading server settings...",
    );
  }

  return trustDefinition();
}

function getTrustedVaults() {
  return serverSettings.get().trustedVaults || [];
}

function trustDefinition() {
  return {
    name: "Always trust plugins for this vault",
    desc: "Enable community plugins for this vault in every browser that opens it, so the restricted-mode prompt does not appear on a new device or after clearing site data.",
    render: (setting) => {
      const vaultId = vaultService.getCurrentVaultId();

      setting.addToggle((toggle) => {
        toggle.setValue(getTrustedVaults().includes(vaultId));

        toggle.onChange(async (value) => {
          const trustedVaults = getTrustedVaults();

          if (value === trustedVaults.includes(vaultId)) {
            return;
          }

          const saved = await serverSettings.save({
            trustedVaults: value
              ? [...trustedVaults, vaultId]
              : trustedVaults.filter((id) => id !== vaultId),
          });

          if (!saved) {
            toggle.setValue(!value);
            return;
          }

          if (value) {
            vaultService.setVaultTrust(vaultId);
          }
        });
      });
    },
  };
}

export { settingDefinitions };
