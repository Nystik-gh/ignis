import { markSentOp } from "./echo-guard.js";
import {
  bufferWrite,
  cancelPending,
  COALESCE_MAX_BYTES,
  enqueue,
  enqueueMutation,
  enqueueWrite,
  hasPending,
  initWriteCoalescer,
  isBooting,
  whenIdle,
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
import { initWriteDurability } from "./write-durability.js";
import { createUtimes } from "./utimes.js";
import { createMutations } from "./mutations.js";
import { utf8ByteLength } from "../util/utf8.js";
import { createReadAhead } from "./read-ahead.js";
import { isTextPath } from "./indexer-prefetch.js";

export function createFsPromises(metadataCache, contentCache, transport) {
  initWriteCoalescer(transport);
  initWriteDurability(transport, enqueue);

  const commitUtimes = createUtimes(metadataCache, transport);
  const { commitAppend, commitCopy, commitRemove, commitRename } =
    createMutations(metadataCache, contentCache, transport);
  const readAhead = createReadAhead(metadataCache, contentCache);

  async function appendFile(path, data, encoding) {
    const resolved = resolvePath(path);

    await commitAppend(resolved, data, () =>
      transport.appendFile(resolved, data),
    );
  }

  return {
    async stat(path) {
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

      const { resolved, redirected } = resolvePathInfo(path);
      const cached = metadataCache.toStat(resolved);

      if (cached) {
        return cached;
      }

      if (!redirected) {
        const e = new Error(
          `ENOENT: no such file or directory, stat '${path}'`,
        );

        e.code = "ENOENT";
        throw e;
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
        const pendingBatch = readAhead.inFlightBatchFor(resolved);

        if (pendingBatch) {
          await pendingBatch;
          result = contentCache.get(resolved);
        }
      }

      if (result === null) {
        await whenIdle(resolved);
        result = contentCache.get(resolved);
      }

      const removedWhileWaiting =
        result === null && !redirected && !metadataCache.has(resolved);

      if (removedWhileWaiting) {
        const e = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        );
        e.code = "ENOENT";
        throw e;
      }

      if (result === null) {
        if (isTextPath(resolved) && !redirected) {
          readAhead.fetchAround(resolved);
        }

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

    async writeFile(path, data, options) {
      const appendsToFile = options?.flag === "a" || options?.flag === "a+";

      if (appendsToFile) {
        await appendFile(path, data);
        return;
      }

      const encoding =
        typeof options === "object" ? options?.encoding : options;
      const resolved = resolvePath(path);
      const transformed = applyWriteTransform(resolved, data);

      contentCache.set(resolved, transformed);

      const size =
        typeof transformed === "string"
          ? utf8ByteLength(transformed)
          : transformed.byteLength || 0;

      const written = {
        type: "file",
        size,
        mtime: Date.now(),
        ctime: metadataCache.get(resolved)?.ctime || Date.now(),
      };

      const applyResult = (result) => {
        const replacedSinceWrite = metadataCache.get(resolved) !== written;

        if (replacedSinceWrite) {
          return;
        }

        metadataCache.set(resolved, {
          type: "file",
          size: result.size || size,
          mtime: result.mtime,
          ctime: written.ctime,
        });
      };

      metadataCache.set(resolved, written);

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

    appendFile,

    async unlink(path) {
      const resolved = resolvePath(path);

      await commitRemove(resolved, () => transport.unlink(resolved));
    },

    async rename(oldPath, newPath) {
      const resolvedOld = resolvePath(oldPath);
      const resolvedNew = resolvePath(newPath);

      await commitRename(resolvedOld, resolvedNew, () =>
        transport.rename(resolvedOld, resolvedNew),
      );
    },

    async mkdir(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : !!options;

      const resolved = resolvePath(path);

      markSentOp(resolved);
      metadataCache.set(resolved, { type: "directory" });

      await enqueueMutation([resolved], () => {
        markSentOp(resolved);

        return transport.mkdir(resolved, recursive);
      });
    },

    async rmdir(path, options) {
      const recursive = !!options?.recursive;
      const resolved = resolvePath(path);

      if (metadataCache.get(resolved)?.type === "file") {
        const e = new Error(`ENOTDIR: not a directory, rmdir '${path}'`);

        e.code = "ENOTDIR";
        throw e;
      }

      await commitRemove(resolved, () =>
        recursive ? transport.rm(resolved, true) : transport.rmdir(resolved),
      );
    },

    async rm(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;

      const resolved = resolvePath(path);

      await commitRemove(resolved, () => transport.rm(resolved, recursive));
    },

    async copyFile(src, dest) {
      const resolvedSrc = resolvePath(src);
      const resolvedDest = resolvePath(dest);

      await commitCopy(resolvedSrc, resolvedDest, () =>
        transport.copyFile(resolvedSrc, resolvedDest),
      );
    },

    async access(path) {
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        return;
      }

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
