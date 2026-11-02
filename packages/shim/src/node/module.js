// Shim for Node's `module` module, backed by the shim's require registry.

export const builtinModules = [];

export function createRequire() {
  return window.require;
}
