export function createFsWatch(transport) {
  const watchers = new Map(); // path -> Set<listener>

  return {
    watch(path, options, listener) {
      if (typeof options === "function") {
        listener = options;
        options = {};
      }

      if (!watchers.has(path)) {
        watchers.set(path, new Set());
      }

      // Wrapper that holds both direct listener and .on() listeners
      const entry = {
        direct: typeof listener === "function" ? listener : null,
        eventListeners: new Map(), // event name -> Set<fn>
        call(eventType, filename) {
          if (this.direct) {
            this.direct(eventType, filename);
          }
          const fns = this.eventListeners.get("change");
          if (fns) {
            for (const fn of fns) {
              try {
                fn(eventType, filename);
              } catch (e) {
                console.error("[shim:fs:watch] Listener error:", e);
              }
            }
          }
        },
      };

      watchers.get(path).add(entry);

      // Return a watcher-like object
      return {
        close() {
          const set = watchers.get(path);
          if (set) {
            set.delete(entry);

            if (set.size === 0) {
              watchers.delete(path);
            }
          }
        },
        on(event, fn) {
          if (!entry.eventListeners.has(event)) {
            entry.eventListeners.set(event, new Set());
          }

          entry.eventListeners.get(event).add(fn);

          return this;
        },
        once(event, fn) {
          const wrapped = (...args) => {
            this.removeListener(event, wrapped);
            fn(...args);
          };

          return this.on(event, wrapped);
        },
        removeListener(event, fn) {
          const fns = entry.eventListeners.get(event);

          if (fns) {
            fns.delete(fn);
          }
          return this;
        },
      };
    },

    // Internal: called when transport receives a file-change event
    _dispatch(eventType, filePath) {
      const normFile = (filePath || "").replace(/^\/+/, "");
      let matched = false;

      for (const [watchPath, listeners] of watchers) {
        const normWatch = (watchPath || "").replace(/^\/+/, "");
        // Empty normWatch means root watcher  -  matches everything
        const isMatch =
          normWatch === "" ||
          normFile === normWatch ||
          normFile.startsWith(normWatch + "/");

        if (isMatch) {
          matched = true;
          const relativeName =
            normWatch === ""
              ? normFile
              : normFile.slice(normWatch.length + 1) || normFile;

          for (const entry of listeners) {
            try {
              entry.call(eventType, relativeName);
            } catch (e) {
              console.error("[shim:fs:watch] Listener error:", e);
            }
          }
        }
      }
    },
  };
}
