import { markSentOp } from "./echo-guard.js";
import {
  bufferWrite,
  cancelPending,
  COALESCE_MAX_BYTES,
  enqueue,
  enqueueWrite,
  hasPending,
  initWriteCoalescer,
  isBooting,
} from "./write-coalescer.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import {
  applyReadTransform,
  applyWriteTransform,
  resolvePath,
  resolvePathInfo,
} from "./transforms.js";
import { hasVirtualFile, getVirtualFile } from "./virtual-files.js";
import { realpathSync } from "./realpath.js";
import { initWriteDurability, onFailure } from "./write-durability.js";
import { createUtimes } from "./utimes.js";

export function createFsPromises(metadataCache, contentCache, transport) {
  initWriteCoalescer(transport);
  initWriteDurability(transport, enqueue);

  // On give-up, drop the optimistic content so a re-read returns server truth.
  // Metadata is left as-is: a reconciling stat would also fail (server unreachable) and deleting on that would lose a live file.
  onFailure((failedPath) => {
    contentCache.invalidate(failedPath);
  });

  const commitUtimes = createUtimes(metadataCache, transport);

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
      const { resolved, redirected } = resolvePathInfo(path);

      // Virtual plugin source overrides any cache/transport version.
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

        if (!meta && !redirected) {
          // The metadata cache holds every existing path (populated at bootstrap, kept current by the watcher).
          // A cache miss on a non-redirected path is genuinely absent. Redirected paths fall through to the transport.
          const e = new Error(
            `ENOENT: no such file or directory, open '${path}'`,
          );
          e.code = "ENOENT";
          throw e;
        }

        result = contentCache.get(resolved);
      }

      if (result === null) {
        const pathUpdatesBefore = contentCache.pathUpdates(resolved);

        try {
          result = await transport.readFile(resolved, encoding);
        } catch (e) {
          if (redirected && e.code === "ENOENT") {
            result = await transport.readFile(path, encoding);
          } else {
            throw e;
          }
        }

        contentCache.setFromServer(resolved, result, pathUpdatesBefore);
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

      if (isBooting() && size <= COALESCE_MAX_BYTES) {
        bufferWrite(resolved, transformed, encoding, applyResult);
        return;
      }

      // An awaited write supersedes a still-buffered one for this path.
      if (hasPending(resolved)) {
        cancelPending(resolved);
      }

      try {
        await enqueueWrite(resolved, transformed, encoding, applyResult);
      } catch {
        // The durability queue owns retrying a failed write, so resolve optimistically.
        // A lost write surfaces through the status-bar signal and the give-up Notice.
      }
    },

    async appendFile(path, data, encoding) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      contentCache.invalidate(resolved);

      await transport.appendFile(resolved, data);

      const meta = await transport.stat(resolved);
      metadataCache.set(resolved, meta);
    },

    async unlink(path) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      contentCache.delete(resolved);
      metadataCache.delete(resolved);

      await transport.unlink(resolved);
    },

    async rename(oldPath, newPath) {
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

      await transport.rename(resolvedOld, resolvedNew);
    },

    async mkdir(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : !!options;

      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.set(resolved, { type: "directory" });

      await transport.mkdir(resolved, recursive);
    },

    async rmdir(path) {
      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.delete(resolved);
      await transport.rmdir(resolved);
    },

    async rm(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.delete(resolved);
      contentCache.delete(resolved);

      await transport.rm(resolved, recursive);
    },

    async copyFile(src, dest) {
      const resolvedDest = resolvePath(dest);

      markSentOp(resolvedDest);
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

      // No symlinks in the vault FS, so realpath is the identity.
      return realpathSync(path);
    },

    async utimes(path, atime, mtime) {
      await commitUtimes(path, atime, mtime);
    },

    async lutimes(path, atime, mtime) {
      await commitUtimes(path, atime, mtime);
    },

    async chmod() {
      // No permission bits in the vault FS. No-op.
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

        async utimes(atime, mtime) {
          await commitUtimes(path, atime, mtime);
        },

        async close() {
          // Nothing to clean up; data is in memory.
        },
      };
    },
  };
}
