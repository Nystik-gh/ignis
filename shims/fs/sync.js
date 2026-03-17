export function createFsSync(metadataCache, contentCache, transport) {
  return {
    existsSync(path) {
      return metadataCache.has(path);
    },

    statSync(path) {
      const stat = metadataCache.toStat(path);

      if (!stat) {
        const err = new Error(
          `ENOENT: no such file or directory, stat '${path}'`,
        );
        err.code = "ENOENT";
        throw err;
      }

      return stat;
    },

    accessSync(path, mode) {
      if (!metadataCache.has(path)) {
        const err = new Error(
          `ENOENT: no such file or directory, access '${path}'`,
        );
        err.code = "ENOENT";
        throw err;
      }
    },

    readFileSync(path, encoding) {
      if (typeof encoding === "object") {
        encoding = encoding?.encoding;
      }

      const meta = metadataCache.get(path);
      if (meta && meta.type === "directory") {
        const e = new Error("EISDIR: illegal operation on a directory, read");
        e.code = "EISDIR";
        throw e;
      }

      const cached = contentCache.get(path);
      if (cached !== null) {
        if (encoding === "utf8" || encoding === "utf-8") {
          return typeof cached === "string"
            ? cached
            : new TextDecoder().decode(cached);
        }

        return cached;
      }

      console.warn("[shim:fs] readFileSync cache miss, using sync XHR:", path);

      const data = transport.readFileSync(path, encoding);
      contentCache.set(path, data);

      return data;
    },

    writeFileSync(path, data, encoding) {
      if (typeof encoding === "object") {
        encoding = encoding?.encoding;
      }

      contentCache.set(path, data);

      const size =
        typeof data === "string" ? data.length : data.byteLength || 0;

      metadataCache.set(path, {
        type: "file",
        size,
        mtime: Date.now(),
        ctime: metadataCache.get(path)?.ctime || Date.now(),
      });

      // Fire-and-forget async send to server
      transport.writeFile(path, data, encoding).catch((e) => {
        console.error(
          "[shim:fs] writeFileSync background save failed:",
          path,
          e,
        );
      });
    },

    unlinkSync(path) {
      contentCache.delete(path);
      metadataCache.delete(path);

      // Fire-and-forget. suppress ENOENT (file already gone)
      transport.unlink(path).catch((e) => {
        if (e.code !== "ENOENT") {
          console.error(
            "[shim:fs] unlinkSync background delete failed:",
            path,
            e,
          );
        }
      });
    },

    readdirSync(path) {
      const entries = metadataCache.readdir(path);
      return entries.map((e) => e.name);
    },
  };
}
