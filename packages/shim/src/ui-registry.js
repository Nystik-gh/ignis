// Use a runtime registry to avoid bloating bundles with imported component code.

let handlers = {};

export function registerUI(impls) {
  handlers = { ...handlers, ...impls };
}

function proxy(name) {
  return (...args) => {
    const fn = handlers[name];

    if (typeof fn !== "function") {
      console.warn(`[ignis] UI handler '${name}' not registered`);
      return undefined;
    }

    return fn(...args);
  };
}

export const showVaultManager = proxy("showVaultManager");
export const showMessageDialog = proxy("showMessageDialog");
export const showConfirmDialog = proxy("showConfirmDialog");
export const showPluginInstallDialog = proxy("showPluginInstallDialog");
export const showPromptDialog = proxy("showPromptDialog");
