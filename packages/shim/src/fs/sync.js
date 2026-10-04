import { markSentOp } from "./echo-guard.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import {
  applyReadTransform,
  applyWriteTransform,
  resolvePath,
  resolvePathInfo,
} from "./transforms.js";
import { hasVirtualFile, getVirtualFile } from "./virtual-files.js";
import { cancelPending, enqueueWrite, hasPending } from "./write-coalescer.js";
import { createUtimes } from "./utimes.js";

export function createFsSync(metadataCache, contentCache, transport) {
  const commitUtimes = createUtimes(metadataCache, transport);

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
      const { resolved, redirected } = resolvePathInfo(path);

      // Virtual plugin source overrides any cache or transport version.
      if (hasVirtualFile(resolved)) {
        const content = getVirtualFile(resolved);

        if (wantText) {
          return typeof content === "string"
            ? content
            : new TextDecoder().decode(content);
        }

        return typeof content === "string"
          ? new TextEncoder().encode(content)
          : content;
      }

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

      // The metadata cache is kept fresh by the filewatcher and a miss here genuinely means the file is absent.
      // Redirected paths fall through to the transport, so we can't trust the cache for them, but non-redirected misses are definitive.
      if (result === null && !meta && !redirected) {
        const e = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        );
        e.code = "ENOENT";
        throw e;
      }

      if (result === null) {
        // A resolver can map a path onto a physical target that does not exist yet, so a redirected miss retries the original path before failing.
        try {
          result = transport.readFileSync(resolved, encoding);
        } catch (e) {
          if (redirected && e.code === "ENOENT") {
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

      contentCache.set(resolved, transformed);

      const size =
        typeof transformed === "string"
          ? transformed.length
          : transformed.byteLength || 0;

      const applyResult = (result) => {
        metadataCache.set(resolved, {
          type: "file",
          size: result.size || size,
          mtime: result.mtime,
          ctime: metadataCache.get(resolved)?.ctime || Date.now(),
        });
      };

      metadataCache.set(resolved, {
        type: "file",
        size,
        mtime: Date.now(),
        ctime: metadataCache.get(resolved)?.ctime || Date.now(),
      });

      if (hasPending(resolved)) {
        cancelPending(resolved);
      }

      // Fire-and-forget.
      enqueueWrite(resolved, transformed, encoding, applyResult, {
        silent: true,
      }).catch(() => {});
    },

    unlinkSync(path) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      contentCache.delete(resolved);
      metadataCache.delete(resolved);

      // Fire-and-forget. suppress ENOENT (file already gone)
      transport.unlink(resolved).catch((e) => {
        if (e.code !== "ENOENT") {
          console.error(
            "[shim:fs] unlinkSync background delete failed:",
            resolved,
            e,
          );
        }
      });
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

      markSentOp(resolved);
      metadataCache.set(resolved, { type: "directory" });

      transport.mkdir(resolved, recursive).catch((e) => {
        console.error(
          "[shim:fs] mkdirSync background create failed:",
          resolved,
          e,
        );
      });
    },

    rmdirSync(path) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.delete(resolved);

      transport.rmdir(resolved).catch((e) => {
        console.error(
          "[shim:fs] rmdirSync background remove failed:",
          resolved,
          e,
        );
      });
    },

    rmSync(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.delete(resolved);
      contentCache.delete(resolved);

      transport.rm(resolved, recursive).catch((e) => {
        console.error(
          "[shim:fs] rmSync background remove failed:",
          resolved,
          e,
        );
      });
    },

    renameSync(oldPath, newPath) {
      const resolvedOld = resolvePath(oldPath);
      const resolvedNew = resolvePath(newPath);

      markSentOp(resolvedOld);
      markSentOp(resolvedNew);

      for (const key of metadataCache.rename(resolvedOld, resolvedNew)) {
        contentCache.delete(key);
      }

      const content = contentCache.get(resolvedOld);

      if (content !== null) {
        contentCache.set(resolvedNew, content);
        contentCache.delete(resolvedOld);
      }

      transport.rename(resolvedOld, resolvedNew).catch((e) => {
        console.error(
          "[shim:fs] renameSync background rename failed:",
          resolvedOld,
          e,
        );
      });
    },

    copyFileSync(src, dest) {
      const resolvedSrc = resolvePath(src);
      const resolvedDest = resolvePath(dest);

      markSentOp(resolvedDest);

      // Optimistically mirror the source so a sync read right after sees it.
      const content = contentCache.get(resolvedSrc);

      if (content !== null) {
        contentCache.set(resolvedDest, content);
      }

      const srcMeta = metadataCache.get(resolvedSrc);

      if (srcMeta) {
        metadataCache.set(resolvedDest, { ...srcMeta });
      }

      transport
        .copyFile(src, resolvedDest)
        .then(() => transport.stat(resolvedDest))
        .then((meta) => metadataCache.set(resolvedDest, meta))
        .catch((e) => {
          console.error(
            "[shim:fs] copyFileSync background copy failed:",
            resolvedDest,
            e,
          );
        });
    },

    appendFileSync(path, data) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      contentCache.invalidate(resolved);

      transport
        .appendFile(resolved, data)
        .then(() => transport.stat(resolved))
        .then((meta) => metadataCache.set(resolved, meta))
        .catch((e) => {
          console.error(
            "[shim:fs] appendFileSync background append failed:",
            resolved,
            e,
          );
        });
    },

    utimesSync(path, atime, mtime) {
      commitUtimes(path, atime, mtime);
    },

    lutimesSync(path, atime, mtime) {
      commitUtimes(path, atime, mtime);
    },

    chmodSync() {
      // The vault FS does not model permission bits. No-op.
    },
  };
}
