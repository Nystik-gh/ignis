import { markLocalOp } from "./echo-guard.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import { applyReadTransform } from "./read-transforms.js";

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

      let result = null;

      // Check input cache for files picked via browser file dialogs.
      if (isInputCachePath(path)) {
        result = inputCacheGet(path);
      }

      if (result === null) {
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

        result = contentCache.get(path);
      }

      if (result === null) {
        result = await transport.readFile(path, encoding);
        contentCache.set(path, result);
      }

      // Apply registered read transforms (e.g., patching synced config files).
      result = applyReadTransform(path, result);

      if (wantText) {
        return typeof result === "string"
          ? result
          : new TextDecoder().decode(result);
      }

      if (typeof result === "string") {
        return new TextEncoder().encode(result);
      }

      return result;
    },

    async writeFile(path, data, encoding) {
      if (typeof encoding === "object") {
        encoding = encoding?.encoding;
      }

      markLocalOp(path);
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
      markLocalOp(path);
      contentCache.invalidate(path);

      await transport.appendFile(path, data);

      const meta = await transport.stat(path);
      metadataCache.set(path, meta);
    },

    async unlink(path) {
      markLocalOp(path);
      contentCache.delete(path);
      metadataCache.delete(path);

      await transport.unlink(path);
    },

    async rename(oldPath, newPath) {
      markLocalOp(oldPath);
      markLocalOp(newPath);
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

      markLocalOp(path);
      metadataCache.set(path, { type: "directory" });

      await transport.mkdir(path, recursive);
    },

    async rmdir(path) {
      markLocalOp(path);
      metadataCache.delete(path);
      await transport.rmdir(path);
    },

    async rm(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      markLocalOp(path);
      metadataCache.delete(path);
      contentCache.delete(path);

      await transport.rm(path, recursive);
    },

    async copyFile(src, dest) {
      markLocalOp(dest);
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

    async open(path, flags) {
      const hasInCache = isInputCachePath(path) && inputCacheGet(path) !== null;

      if (!hasInCache && !metadataCache.has(path)) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        );
        err.code = "ENOENT";
        throw err;
      }

      const data = await this.readFile(path);
      const fileData =
        typeof data === "string" ? new TextEncoder().encode(data) : data;

      const fileStat = metadataCache.toStat(path) || {
        size: fileData.length,
        isFile: () => true,
        isDirectory: () => false,
      };

      return {
        async stat() {
          return fileStat;
        },

        async read(buffer, offset, length, position) {
          const available = Math.min(length, fileData.length - position);

          if (available <= 0) {
            return { bytesRead: 0, buffer };
          }

          const slice = fileData.subarray(position, position + available);
          buffer.set(slice, offset);

          return { bytesRead: available, buffer };
        },

        async close() {
          // Nothing to clean up  -  data is in memory
        },
      };
    },
  };
}
