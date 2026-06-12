import { markLocalOp } from "./echo-guard.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import {
  applyReadTransform,
  applyWriteTransform,
  resolvePath,
} from "./transforms.js";

export function createFsSync(metadataCache, contentCache, transport) {
  return {
    existsSync(path) {
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        return true;
      }

      const resolved = resolvePath(path);
      return metadataCache.has(resolved);
    },

    statSync(path) {
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        const data = inputCacheGet(path);
        const size = data ? data.length || data.byteLength || 0 : 0;

        return {
          size,
          mtime: new Date(),
          ctime: new Date(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        };
      }

      const resolved = resolvePath(path);
      const stat = metadataCache.toStat(resolved);

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
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        return;
      }

      const resolved = resolvePath(path);

      if (!metadataCache.has(resolved)) {
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

      const wantText = encoding === "utf8" || encoding === "utf-8";
      const resolved = resolvePath(path);

      const meta = metadataCache.get(resolved);
      if (meta && meta.type === "directory") {
        const e = new Error("EISDIR: illegal operation on a directory, read");
        e.code = "EISDIR";
        throw e;
      }

      let result = null;

      // Check input cache for files picked via browser file dialogs.
      if (isInputCachePath(path)) {
        const inputData = inputCacheGet(path);

        if (inputData !== null) {
          result = inputData;
        }
      }

      if (result === null) {
        result = contentCache.get(resolved);
      }

      if (result === null) {
        // ENOENT fallback: if the resolved path doesn't exist, try the original.
        // Covers per-name workspace files that haven't been saved yet.
        try {
          result = transport.readFileSync(resolved, encoding);
        } catch (e) {
          if (resolved !== path && e.code === "ENOENT") {
            console.warn(
              "[shim:fs] readFileSync cache miss, using sync XHR:",
              path,
            );
            result = transport.readFileSync(path, encoding);
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

      return result;
    },

    writeFileSync(path, data, encoding) {
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

      // Synchronous XHR so the write is durable before we return.
      // Without this, a page refresh before the async fetch completes
      // discards the in-memory cache and aborts the request, losing data.
      transport.writeFileSync(resolved, transformed, encoding);
    },

    unlinkSync(path) {
      const resolved = resolvePath(path);

      markLocalOp(resolved);
      contentCache.delete(resolved);
      metadataCache.delete(resolved);

      transport.unlinkSync(resolved);
    },

    readdirSync(path) {
      const entries = metadataCache.readdir(path);
      return entries.map((e) => e.name);
    },

    lstatSync(path) {
      // No symlinks in our context.
      return this.statSync(path);
    },

    mkdirSync(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : !!options;

      const resolved = resolvePath(path);

      markLocalOp(resolved);
      metadataCache.set(resolved, { type: "directory" });

      transport.mkdirSync(resolved, recursive);
    },

    rmdirSync(path) {
      const resolved = resolvePath(path);

      markLocalOp(resolved);
      metadataCache.delete(resolved);

      transport.rmdirSync(resolved);
    },

    rmSync(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      const resolved = resolvePath(path);

      markLocalOp(resolved);
      metadataCache.delete(resolved);
      contentCache.delete(resolved);

      transport.rmSync(resolved, recursive);
    },

    renameSync(oldPath, newPath) {
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

      transport.renameSync(resolvedOld, resolvedNew);
    },

    copyFileSync(src, dest) {
      const resolvedSrc = resolvePath(src);
      const resolvedDest = resolvePath(dest);

      markLocalOp(resolvedDest);

      // Optimistically mirror the source so a sync read right after sees it.
      const content = contentCache.get(resolvedSrc);

      if (content !== null) {
        contentCache.set(resolvedDest, content);
      }

      const srcMeta = metadataCache.get(resolvedSrc);

      if (srcMeta) {
        metadataCache.set(resolvedDest, { ...srcMeta });
      }

      transport.copyFileSync(resolvedSrc, resolvedDest);
    },

    appendFileSync(path, data) {
      const resolved = resolvePath(path);

      markLocalOp(resolved);
      contentCache.invalidate(resolved);

      transport.appendFileSync(resolved, data);
    },

    utimesSync(path, atime, mtime) {
      const resolved = resolvePath(path);
      const meta = metadataCache.get(resolved);

      if (meta) {
        meta.mtime = typeof mtime === "number" ? mtime : mtime.getTime();
        metadataCache.set(resolved, meta);
      }

      transport.utimesSync(resolved, atime, mtime);
    },

    chmodSync() {
      // The vault FS does not model permission bits. No-op.
    },
  };
}
