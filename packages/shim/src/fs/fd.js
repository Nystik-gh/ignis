// File descriptor shim  -  maps fake integer fds to in-memory file buffers.
// Enables libraries like yauzl that use fs.open/fs.read/fs.close to seek
// around files without loading them via readFileSync upfront.

import { isInputCachePath, inputCacheGet } from "./input-cache.js";
import { resolvePath } from "./transforms.js";

let nextFd = 100;
const openFiles = new Map();

export function createFdOps(metadataCache, contentCache, transport) {
  function ensureData(path) {
    // Check input cache first for files picked via browser file dialogs.
    if (isInputCachePath(path)) {
      const inputData = inputCacheGet(path);

      if (inputData !== null) {
        if (typeof inputData === "string") {
          return new TextEncoder().encode(inputData);
        }

        return inputData;
      }
    }

    const resolved = resolvePath(path);
    const cached = contentCache.get(resolved);

    if (cached !== null) {
      if (typeof cached === "string") {
        return new TextEncoder().encode(cached);
      }

      return cached;
    }

    // Synchronous fetch fallback
    console.warn("[shim:fs] fd open cache miss, using sync XHR:", resolved);
    const data = transport.readFileSync(resolved);
    contentCache.set(resolved, data);

    return data;
  }

  function getEntry(fd) {
    const entry = openFiles.get(fd);

    if (!entry) {
      const err = new Error(`EBADF: bad file descriptor, fd ${fd}`);
      err.code = "EBADF";
      throw err;
    }

    return entry;
  }

  // --- Sync ---

  function openSync(path, flags, mode) {
    const hasInCache = isInputCachePath(path) && inputCacheGet(path) !== null;
    const resolved = resolvePath(path);

    if (!hasInCache && !metadataCache.has(resolved)) {
      const err = new Error(
        `ENOENT: no such file or directory, open '${path}'`,
      );
      err.code = "ENOENT";
      throw err;
    }

    const data = ensureData(path);
    const fd = nextFd++;
    openFiles.set(fd, { path: resolved, data });

    return fd;
  }

  function readSync(fd, buffer, offset, length, position) {
    const entry = getEntry(fd);
    const available = Math.min(length, entry.data.length - position);

    if (available <= 0) {
      return 0;
    }

    const slice = entry.data.subarray(position, position + available);
    buffer.set(slice, offset);

    return available;
  }

  function closeSync(fd) {
    openFiles.delete(fd);
  }

  function fstatSync(fd) {
    const entry = getEntry(fd);
    const stat = metadataCache.toStat(entry.path);

    if (stat) {
      return stat;
    }

    // Fallback: construct minimal stat from the buffer
    return {
      size: entry.data.length,
      isFile: () => true,
      isDirectory: () => false,
    };
  }

  // --- Async (callback style) ---

  function open(path, flags, modeOrCb, cb) {
    if (typeof modeOrCb === "function") {
      cb = modeOrCb;
    }

    try {
      const fd = openSync(path, flags);
      queueMicrotask(() => cb(null, fd));
    } catch (e) {
      queueMicrotask(() => cb(e));
    }
  }

  function read(fd, buffer, offset, length, position, cb) {
    try {
      const bytesRead = readSync(fd, buffer, offset, length, position);
      queueMicrotask(() => cb(null, bytesRead, buffer));
    } catch (e) {
      queueMicrotask(() => cb(e));
    }
  }

  function close(fd, cb) {
    try {
      closeSync(fd);

      if (cb) {
        queueMicrotask(() => cb(null));
      }
    } catch (e) {
      if (cb) {
        queueMicrotask(() => cb(e));
      }
    }
  }

  function fstat(fd, optionsOrCb, cb) {
    if (typeof optionsOrCb === "function") {
      cb = optionsOrCb;
    }

    try {
      const stat = fstatSync(fd);
      queueMicrotask(() => cb(null, stat));
    } catch (e) {
      queueMicrotask(() => cb(e));
    }
  }

  return {
    openSync,
    readSync,
    closeSync,
    fstatSync,
    open,
    read,
    close,
    fstat,
  };
}
