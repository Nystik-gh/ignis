import { vaultService } from "@ignis/services";

function showVaultManager() {
  if (document.querySelector(".vault-manager-overlay")) return;

  new window.IgnisUI.VaultManager({
    target: document.body,
    props: { vaultService },
  });
}

function showMessageDialog(title, message) {
  return new Promise((resolve) => {
    const dialog = new window.IgnisUI.MessageDialog({
      target: document.body,
      props: { title, message },
    });

    dialog.$on("confirm", () => {
      dialog.$destroy();
      resolve();
    });
  });
}

function showConfirmDialog(
  title,
  message,
  description,
  confirmText = "OK",
) {
  return new Promise((resolve) => {
    const dialog = new window.IgnisUI.ConfirmDialog({
      target: document.body,
      props: { title, message, description, confirmText },
    });

    dialog.$on("confirm", () => {
      dialog.$destroy();
      resolve(true);
    });

    dialog.$on("cancel", () => {
      dialog.$destroy();
      resolve(false);
    });
  });
}

function showPluginInstallDialog(vaultId) {
  return new Promise((resolve) => {
    const dialog = new window.IgnisUI.PluginInstallDialog({
      target: document.body,
    });

    dialog.$on("install", async () => {
      try {
        await fetch("/api/vault/install-plugin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault: vaultId }),
        });
      } catch (e) {
        console.error("[ignis] Failed to install plugin:", e);
      }
      dialog.$destroy();
      resolve("install");
    });

    dialog.$on("dismiss", async () => {
      try {
        await fetch("/api/vault/install-plugin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault: vaultId, dismiss: true }),
        });
      } catch (e) {
        console.error("[ignis] Failed to dismiss plugin prompt:", e);
      }
      dialog.$destroy();
      resolve("dismiss");
    });
  });
}

function showPromptDialog(
  title,
  label,
  placeholder = "",
  value = "",
  confirmText = "OK",
) {
  return new Promise((resolve) => {
    const dialog = new window.IgnisUI.PromptDialog({
      target: document.body,
      props: { title, label, placeholder, value, confirmText },
    });

    dialog.$on("confirm", (event) => {
      dialog.$destroy();
      resolve(event.detail);
    });

    dialog.$on("cancel", () => {
      dialog.$destroy();
      resolve(null);
    });
  });
}

if (typeof window !== "undefined" && window.__ignis_registerUI) {
  window.__ignis_registerUI({
    showVaultManager,
    showMessageDialog,
    showConfirmDialog,
    showPluginInstallDialog,
    showPromptDialog,
  });
} else if (typeof window !== "undefined") {
  console.warn(
    "[ignis] __ignis_registerUI not available; UI handlers not registered",
  );
}
