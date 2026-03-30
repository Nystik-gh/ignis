import { markLocalOp } from "./echo-guard.js";
import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import { applyReadTransform } from "./read-transforms.js";

export function createFsSync(metadataCache, contentCache, transport) {
  return {
    existsSync(path) {
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        return true;
      }

      return metadataCache.has(path);
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
      if (isInputCachePath(path) && inputCacheGet(path) !== null) {
        return;
      }

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

      const wantText = encoding === "utf8" || encoding === "utf-8";

      const meta = metadataCache.get(path);
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
        result = contentCache.get(path);
      }

      if (result === null) {
        console.warn("[shim:fs] readFileSync cache miss, using sync XHR:", path);
        result = transport.readFileSync(path, encoding);
        contentCache.set(path, result);
      }

      // Apply registered read transforms (e.g., patching synced config files).
      result = applyReadTransform(path, result);

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
      markLocalOp(path);
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
