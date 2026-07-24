import { vaultService } from "@ignis/services";
import InsecureContextModal from "./components/layout/InsecureContextModal.svelte";

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

function showConfirmDialog(title, message, description, confirmText = "OK") {
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
    showPromptDialog,
  });
} else if (typeof window !== "undefined") {
  console.warn(
    "[ignis] __ignis_registerUI not available; UI handlers not registered",
  );
}

const INSECURE_ACK_KEY = "ignis-insecure-ack";

function showInsecureContextModal() {
  if (window.isSecureContext) {
    return;
  }

  if (localStorage.getItem(INSECURE_ACK_KEY)) {
    return;
  }

  const modal = new InsecureContextModal({ target: document.body });
  modal.$on("close", () => {
    localStorage.setItem(INSECURE_ACK_KEY, "1");
    modal.$destroy();
  });
}

if (typeof window !== "undefined") {
  if (document.body) {
    showInsecureContextModal();
  } else {
    window.addEventListener("DOMContentLoaded", showInsecureContextModal, {
      once: true,
    });
  }
}
