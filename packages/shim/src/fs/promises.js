import { markLocalOp } from "./echo-guard.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import { applyReadTransform, applyWriteTransform, resolvePath } from "./transforms.js";

export function createFsPromises(metadataCache, contentCache, transport) {
  return {
    async stat(path) {
      const resolved = resolvePath(path);
      const cached = metadataCache.toStat(resolved);

      if (cached) {
        return cached;
      }

      const meta = await transport.stat(resolved);
      metadataCache.set(resolved, meta);
      return metadataCache.toStat(resolved);
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
      const resolved = resolvePath(path);

      let result = null;

      // Check input cache for files picked via browser file dialogs.
      if (isInputCachePath(path)) {
        result = inputCacheGet(path);
      }

      if (result === null) {
        const meta = metadataCache.get(resolved);

        if (meta && meta.type === "directory") {
          const e = new Error("EISDIR: illegal operation on a directory, read");
          e.code = "EISDIR";
          throw e;
        }

        if (!meta && resolved && resolved === path) {
          // Throw ENOENT only when not redirected; redirected paths fall through to the transport's fallback.
          const e = new Error(
            `ENOENT: no such file or directory, open '${path}'`,
          );
          e.code = "ENOENT";
          throw e;
        }

        result = contentCache.get(resolved);
      }

      if (result === null) {
        try {
          result = await transport.readFile(resolved, encoding);
        } catch (e) {
          if (resolved !== path && e.code === "ENOENT") {
            result = await transport.readFile(path, encoding);
          } else {
            throw e;
          }
        }

        contentCache.set(resolved, result);
      }

      // Apply registered read transforms (e.g., patching synced config files).
      result = applyReadTransform(resolved, result);

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

      const resolved = resolvePath(path);
      const transformed = applyWriteTransform(resolved, data);

      markLocalOp(resolved);
      contentCache.set(resolved, transformed);

      const size =
        typeof transformed === "string"
          ? transformed.length
          : transformed.byteLength || 0;

      metadataCache.set(resolved, {
        type: "file",
        size,
        mtime: Date.now(),
        ctime: metadataCache.get(resolved)?.ctime || Date.now(),
      });

      const result = await transport.writeFile(resolved, transformed, encoding);

      if (result.mtime) {
        metadataCache.set(resolved, {
          type: "file",
          size: result.size || size,
          mtime: result.mtime,
          ctime: metadataCache.get(resolved)?.ctime || Date.now(),
        });
      }
    },

    async appendFile(path, data, encoding) {
      const resolved = resolvePath(path);

      markLocalOp(resolved);
      contentCache.invalidate(resolved);

      await transport.appendFile(resolved, data);

      const meta = await transport.stat(resolved);
      metadataCache.set(resolved, meta);
    },

    async unlink(path) {
      const resolved = resolvePath(path);

      markLocalOp(resolved);
      contentCache.delete(resolved);
      metadataCache.delete(resolved);

      await transport.unlink(resolved);
    },

    async rename(oldPath, newPath) {
      const resolvedOld = resolvePath(oldPath);
      const resolvedNew = resolvePath(newPath);

      markLocalOp(resolvedOld);
      markLocalOp(resolvedNew);
      const content = contentCache.get(resolvedOld);

      if (content !== null) {
        contentCache.set(resolvedNew, content);
        contentCache.delete(resolvedOld);
      }

      metadataCache.rename(resolvedOld, resolvedNew);

      await transport.rename(resolvedOld, resolvedNew);
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

      const resolved = resolvePath(path);

      markLocalOp(resolved);
      metadataCache.delete(resolved);
      contentCache.delete(resolved);

      await transport.rm(resolved, recursive);
    },

    async copyFile(src, dest) {
      const resolvedDest = resolvePath(dest);

      markLocalOp(resolvedDest);
      await transport.copyFile(src, resolvedDest);

      const meta = await transport.stat(resolvedDest);
      metadataCache.set(resolvedDest, meta);
    },

    async access(path) {
      const resolved = resolvePath(path);

      if (metadataCache.has(resolved)) {
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
      const resolved = resolvePath(path);

      await transport.utimes(resolved, atime, mtime);
      const meta = metadataCache.get(resolved);
      if (meta) {
        meta.mtime = typeof mtime === "number" ? mtime : mtime.getTime();
        metadataCache.set(resolved, meta);
      }
    },

    async open(path, flags) {
      const hasInCache = isInputCachePath(path) && inputCacheGet(path) !== null;
      const resolved = resolvePath(path);

      if (!hasInCache && !metadataCache.has(resolved)) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        );
        err.code = "ENOENT";
        throw err;
      }

      const data = await this.readFile(path);
      const fileData =
        typeof data === "string" ? new TextEncoder().encode(data) : data;

      const fileStat = metadataCache.toStat(resolved) || {
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
