// Write coalescer for slow filesystems (rclone, FUSE, NFS, SMB).
//
// First write to a path goes to disk immediately. Subsequent writes within the coalesce window are buffered and flushed when the debounce timer fires; the timer resets on each write.
//
// Buffered writes respond to the HTTP client right away with synthetic mtime/size. Otherwise the browser's per-host connection cap blocks unrelated reads while writes sit in the buffer.

const fs = require("fs");

const FLUSH_TIMEOUT_MS = 10000;

// Coalesce window in ms. 0 disables coalescing. Set via configure({ writeCoalesceMs }).
let writeCoalesceMs = 0;

function configure(opts) {
  if (typeof opts?.writeCoalesceMs === "number") {
    writeCoalesceMs = opts.writeCoalesceMs;
  }
}

// absPath -> timestamp of last completed (or scheduled) write
const lastWriteTime = new Map();

// absPath -> { data, encoding, timer }
const pending = new Map();

async function writeToDisk(absPath, data, encoding) {
  await fs.promises.writeFile(
    absPath,
    data,
    encoding === "binary" ? undefined : encoding,
  );

  lastWriteTime.set(absPath, Date.now());

  // A concurrent delete can remove the file between the write and the stat (a rapid write-then-delete on the same path).
  // The write itself succeeds, so report synthetic metadata rather than failing the request on the now-missing file.
  try {
    const stat = await fs.promises.stat(absPath);
    return { mtime: stat.mtimeMs, size: stat.size };
  } catch (e) {
    if (e.code === "ENOENT") {
      return { mtime: Date.now(), size: estimateSize(data, encoding) };
    }

    throw e;
  }
}

function flushEntry(absPath) {
  const entry = pending.get(absPath);

  if (!entry) {
    return;
  }

  clearTimeout(entry.timer);
  pending.delete(absPath);

  writeToDisk(absPath, entry.data, entry.encoding).catch((err) => {
    console.error(`[write-coalesce] Flush failed for ${absPath}:`, err);
  });
}

function scheduleFlush(absPath) {
  const entry = pending.get(absPath);

  if (!entry) {
    return;
  }

  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushEntry(absPath), writeCoalesceMs);
}

function estimateSize(data, encoding) {
  if (typeof data === "string") {
    return Buffer.byteLength(data, encoding === "binary" ? "utf-8" : encoding);
  }

  return data.length || data.byteLength || 0;
}

/**
 * Write file content, coalescing rapid writes.
 * Fresh writes resolve with real mtime/size once data is on disk. Buffered writes resolve immediately with synthetic values; the disk flush happens later when the debounce timer fires.
 */
async function writeCoalesced(absPath, data, encoding) {
  const windowMs = writeCoalesceMs;
  const last = lastWriteTime.get(absPath);

  // Fast path: coalescing disabled or far enough from the last write.
  if (windowMs <= 0 || !last || Date.now() - last >= windowMs) {
    if (pending.has(absPath)) {
      clearTimeout(pending.get(absPath).timer);
      pending.delete(absPath);
    }

    return writeToDisk(absPath, data, encoding);
  }

  // Within the coalesce window: buffer the write and respond immediately.
  const existing = pending.get(absPath);

  if (existing) {
    existing.data = data;
    existing.encoding = encoding;
    scheduleFlush(absPath);
  } else {
    pending.set(absPath, {
      data,
      encoding,
      timer: null,
    });
    scheduleFlush(absPath);
  }

  return { mtime: Date.now(), size: estimateSize(data, encoding) };
}

/**
 * Get pending (not yet flushed) data for a path, or null.
 * Used by readFile to serve buffered content instead of stale disk data.
 */
function getPending(absPath) {
  const entry = pending.get(absPath);

  if (entry) {
    return { data: entry.data, encoding: entry.encoding };
  }

  return null;
}

/**
 * Flush all pending writes to disk. Called on graceful shutdown.
 */
async function flushAll() {
  const paths = [...pending.keys()];

  if (paths.length === 0) {
    return;
  }

  console.log(`[write-coalesce] Flushing ${paths.length} pending write(s)...`);

  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }

  const writes = paths.map((absPath) => {
    const entry = pending.get(absPath);
    pending.delete(absPath);

    return writeToDisk(absPath, entry.data, entry.encoding).catch((err) => {
      console.error(`[write-coalesce] Failed to flush ${absPath}:`, err);
    });
  });

  const timeout = new Promise((resolve) => {
    setTimeout(() => {
      console.warn("[write-coalesce] Flush timeout. Some writes may be lost");
      resolve();
    }, FLUSH_TIMEOUT_MS);
  });

  await Promise.race([Promise.allSettled(writes), timeout]);
}

// Test-only: clear all internal state. Not exported for production use.
function _reset() {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
  lastWriteTime.clear();
}

module.exports = { writeCoalesced, getPending, flushAll, configure, _reset };
