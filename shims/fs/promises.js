export function createFsPromises(metadataCache, contentCache, transport) {
  return {
    async stat(path) {
      const cached = metadataCache.toStat(path);

      if (cached) {
        return cached;
      }

      const meta = await transport.stat(path);
      metadataCache.set(path, meta);
      return metadataCache.toStat(path);
    },

    async lstat(path) {
      // No symlinks in our context
      return this.stat(path);
    },

    async readdir(path) {
      const meta = metadataCache.get(path);

      if (meta && meta.type === "file") {
        return [];
      }

      if (!meta && path && path !== "/" && path !== ".") {
        const e = new Error(
          `ENOENT: no such file or directory, scandir '${path}'`,
        );

        e.code = "ENOENT";
        throw e;
      }
      const entries = metadataCache.readdir(path);
      return entries.map((e) => e.name);
    },

    async readFile(path, encoding) {
      if (typeof encoding === "object") {
        encoding = encoding?.encoding;
      }

      const wantText = encoding === "utf8" || encoding === "utf-8";

      const meta = metadataCache.get(path);
      if (meta && meta.type === "directory") {
        const e = new Error("EISDIR: illegal operation on a directory, read");
        e.code = "EISDIR";
        throw e;
      }

      if (!meta && path) {
        const e = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        );
        e.code = "ENOENT";
        throw e;
      }

      const cached = contentCache.get(path);

      if (cached !== null) {
        if (wantText) {
          return typeof cached === "string"
            ? cached
            : new TextDecoder().decode(cached);
        }

        // binary. ensure we return a proper Uint8Array with .buffer
        if (typeof cached === "string") {
          return new TextEncoder().encode(cached);
        }

        return cached;
      }

      const data = await transport.readFile(path, encoding);
      contentCache.set(path, data);
      return data;
    },

    async writeFile(path, data, encoding) {
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

      const result = await transport.writeFile(path, data, encoding);

      if (result.mtime) {
        metadataCache.set(path, {
          type: "file",
          size: result.size || size,
          mtime: result.mtime,
          ctime: metadataCache.get(path)?.ctime || Date.now(),
        });
      }
    },

    async appendFile(path, data, encoding) {
      contentCache.invalidate(path);

      await transport.appendFile(path, data);

      const meta = await transport.stat(path);
      metadataCache.set(path, meta);
    },

    async unlink(path) {
      contentCache.delete(path);
      metadataCache.delete(path);

      await transport.unlink(path);
    },

    async rename(oldPath, newPath) {
      const content = contentCache.get(oldPath);

      if (content !== null) {
        contentCache.set(newPath, content);
        contentCache.delete(oldPath);
      }

      metadataCache.rename(oldPath, newPath);

      await transport.rename(oldPath, newPath);
    },

    async mkdir(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : !!options;

      metadataCache.set(path, { type: "directory" });

      await transport.mkdir(path, recursive);
    },

    async rmdir(path) {
      metadataCache.delete(path);
      await transport.rmdir(path);
    },

    async rm(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      metadataCache.delete(path);
      contentCache.delete(path);

      await transport.rm(path, recursive);
    },

    async copyFile(src, dest) {
      await transport.copyFile(src, dest);

      const meta = await transport.stat(dest);
      metadataCache.set(dest, meta);
    },

    async access(path) {
      if (metadataCache.has(path)) {
        return;
      }

      const e = new Error(
        `ENOENT: no such file or directory, access '${path}'`,
      );
      e.code = "ENOENT";
      throw e;
    },

    async realpath(path) {
      if (!path || path === "/" || path === ".") {
        return "/";
      }

      return transport.realpath(path);
    },

    async utimes(path, atime, mtime) {
      await transport.utimes(path, atime, mtime);
      const meta = metadataCache.get(path);
      if (meta) {
        meta.mtime = typeof mtime === "number" ? mtime : mtime.getTime();
        metadataCache.set(path, meta);
      }
    },
  };
}
