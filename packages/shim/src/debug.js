const DEBUG = true;
const _accessLog = new Map(); // "module.property" -> count

export function wrapWithProxy(obj, name) {
  if (!DEBUG || !obj || typeof obj !== "object") {
    return obj;
  }

  return new Proxy(obj, {
    get(target, prop) {
      if (
        typeof prop === "string" &&
        prop !== "then" &&
        prop !== "toJSON" &&
        !prop.startsWith("_")
      ) {
        const key = `${name}.${prop}`;
        _accessLog.set(key, (_accessLog.get(key) || 0) + 1);

        if (!(prop in target)) {
          console.warn(`[shim:MISS] ${key} - property not found on shim`);
        }
      }

      return target[prop];
    },
  });
}

export function installDebugHelpers(rawRegistry) {
  window.__shimLog = function () {
    const sorted = [..._accessLog.entries()].sort((a, b) => b[1] - a[1]);
    console.table(sorted.map(([k, v]) => ({ api: k, calls: v })));
  };

  window.__shimMisses = function () {
    const sorted = [..._accessLog.entries()]
      .filter(([k]) => {
        const [mod, prop] = k.split(".");
        const shim = rawRegistry[mod];
        return shim && !(prop in shim);
      })
      .sort((a, b) => b[1] - a[1]);

    console.table(sorted.map(([k, v]) => ({ api: k, calls: v })));
  };
}
