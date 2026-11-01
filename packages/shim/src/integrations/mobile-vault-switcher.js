// Populates the vault switcher in Obsidian's mobile drawer with Ignis vaults.

import { vaultService } from "@ignis/services";

export function installMobileVaultSwitcher(app) {
  app.workspace.onLayoutReady(() => {
    const select = document.querySelector(
      ".workspace-drawer-header-switcher select",
    );

    // absent in the desktop UI
    if (!select || select.dataset.ignisVaults) {
      return;
    }

    select.dataset.ignisVaults = "true";
    populate(select);
    intercept(select);
  });
}

// Obsidian fills the list via the iOS/Android adapters only, so a desktop build leaves it empty.
function populate(select) {
  const current = vaultService.getCurrentVaultId();
  const manageOption = select.querySelector('option[value="manage-vaults"]');

  for (const v of window.__vaultList || []) {
    const option = document.createElement("option");
    option.value = v.id;
    option.textContent = v.name || v.id;
    option.selected = v.id === current;
    select.insertBefore(option, manageOption);
  }
}

// intercept vault switch to open vault via Ignis intead.
function intercept(select) {
  const label = select.closest("label") || select.parentElement;

  label.addEventListener(
    "change",
    (e) => {
      if (select.value === "manage-vaults") {
        // let Obsidian open the vault manager, then re-arm so manage can fire again
        setTimeout(() => {
          select.value = vaultService.getCurrentVaultId();
        }, 0);
        return;
      }

      e.stopPropagation();

      if (select.value !== vaultService.getCurrentVaultId()) {
        vaultService.openVault(select.value);
      }
    },
    true,
  );
}
