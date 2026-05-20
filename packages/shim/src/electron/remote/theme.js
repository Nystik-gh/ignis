const listeners = [];

const darkQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

if (darkQuery?.addEventListener) {
  darkQuery.addEventListener("change", () => {
    for (const fn of listeners) {
      fn();
    }
  });
}

export const themeShim = {
  get shouldUseDarkColors() {
    return darkQuery ? darkQuery.matches : true;
  },

  get themeSource() {
    return "system";
  },

  set themeSource(val) {
    // No-op in browser; theme is controlled by OS
  },

  on(event, callback) {
    if (event === "updated") {
      listeners.push(callback);
    }
    return themeShim;
  },

  once(event, callback) {
    if (event === "updated") {
      const wrapped = () => {
        const idx = listeners.indexOf(wrapped);
        if (idx >= 0) {
          listeners.splice(idx, 1);
        }

        callback();
      };
      listeners.push(wrapped);
    }
    return themeShim;
  },

  removeListener(event, callback) {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) {
      listeners.splice(idx, 1);
    }

    return themeShim;
  },

  removeAllListeners() {
    listeners.length = 0;
    return themeShim;
  },
};
