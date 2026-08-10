// Write coalescer for slow filesystems (rclone, FUSE, NFS, SMB).
//
// First write to a path goes to disk immediately. Subsequent writes within the coalesce window are buffered and flushed when the debounce timer fires; the timer resets on each write.
//
// Buffered writes respond to the HTTP client right away with synthetic mtime/size. Otherwise the browser's per-host connection cap blocks unrelated reads while writes sit in the buffer.

const fs = require("fs");
const path = require("path");

const FLUSH_TIMEOUT_MS = 10000;

// Retry attempts before dropping write.
const MAX_FLUSH_ATTEMPTS = 6;

// Retry delays. the last one repeats.
const FLUSH_RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

// Coalesce window in ms. 0 disables coalescing. Set via configure({ writeCoalesceMs }).
let writeCoalesceMs = 0;

let flushRetryBackoffMs = FLUSH_RETRY_BACKOFF_MS;

function configure(opts) {
  if (typeof opts?.writeCoalesceMs === "number") {
    writeCoalesceMs = opts.writeCoalesceMs;
  }

  if (
    Array.isArray(opts?.flushRetryBackoffMs) &&
    opts.flushRetryBackoffMs.length
  ) {
    flushRetryBackoffMs = opts.flushRetryBackoffMs;
  }
}

// absPath -> timestamp of last completed (or scheduled) write
const lastWriteTime = new Map();

// absPath -> { data, encoding, timer, attempts }
const pending = new Map();

// Set<fn(absPath, error)>
const giveUpSubs = new Set();

// fn(absPath, error) runs when a buffered write is dropped.
function onFlushGiveUp(fn) {
  giveUpSubs.add(fn);

  return () => {
    giveUpSubs.delete(fn);
  };
}

function emitGiveUp(absPath, err) {
  for (const fn of giveUpSubs) {
    try {
      fn(absPath, err);
    } catch (e) {
      console.error("[write-coalesce] give-up subscriber threw:", e);
    }
  }
}

async function writeToDisk(absPath, data, encoding) {
  await fs.promises.writeFile(
    absPath,
    data,
    encoding === "binary" ? undefined : encoding,
  );

  lastWriteTime.set(absPath, Date.now());

  try {
    const stat = await fs.promises.stat(absPath);
    return { mtime: stat.mtimeMs, size: stat.size };
  } catch {
    return { mtime: Date.now(), size: estimateSize(data, encoding) };
  }
}

function requeueFailed(absPath, entry, err) {
  if (pending.has(absPath)) {
    // A newer write is already buffered for this path.
    return;
  }

  const attempts = entry.attempts + 1;

  if (attempts > MAX_FLUSH_ATTEMPTS) {
    console.error(
      `[write-coalesce] Giving up on ${absPath} after ${MAX_FLUSH_ATTEMPTS} retries:`,
      err,
    );
    emitGiveUp(absPath, err);
    return;
  }

  const retry = {
    data: entry.data,
    encoding: entry.encoding,
    timer: null,
    attempts,
  };

  const delay =
    flushRetryBackoffMs[Math.min(attempts - 1, flushRetryBackoffMs.length - 1)];

  pending.set(absPath, retry);
  retry.timer = setTimeout(() => flushEntry(absPath), delay);
}

function flushEntry(absPath) {
  const entry = pending.get(absPath);

  if (!entry) {
    return;
  }

  clearTimeout(entry.timer);
  pending.delete(absPath);
  const { data, encoding } = entry;

  writeToDisk(absPath, data, encoding).catch((err) => {
    console.error(`[write-coalesce] Flush failed for ${absPath}:`, err);
    requeueFailed(absPath, entry, err);
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
    existing.attempts = 0; // reset attempts for fresh data.

    scheduleFlush(absPath);
  } else {
    pending.set(absPath, {
      data,
      encoding,
      timer: null,
      attempts: 0,
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

function cancelPending(absPath) {
  const entry = pending.get(absPath);

  if (!entry) {
    return false;
  }

  clearTimeout(entry.timer);
  pending.delete(absPath);
  return true;
}

async function flushPending(absPath) {
  const entry = pending.get(absPath);

  if (!entry) {
    return false;
  }

  clearTimeout(entry.timer);
  pending.delete(absPath);
  const { data, encoding } = entry;

  try {
    await writeToDisk(absPath, data, encoding);
    return true;
  } catch (e) {
    requeueFailed(absPath, entry, e);
    throw e;
  }
}

function cancelPendingSubtree(absDir) {
  const prefix = absDir.endsWith(path.sep) ? absDir : absDir + path.sep;
  let dropped = 0;

  for (const [absPath, entry] of pending) {
    if (absPath === absDir || absPath.startsWith(prefix)) {
      clearTimeout(entry.timer);
      pending.delete(absPath);
      dropped++;
    }
  }

  return dropped;
}

async function flushPendingSubtree(absDir) {
  const prefix = absDir.endsWith(path.sep) ? absDir : absDir + path.sep;
  const targets = [];

  for (const absPath of pending.keys()) {
    if (absPath === absDir || absPath.startsWith(prefix)) {
      targets.push(absPath);
    }
  }

  for (const absPath of targets) {
    await flushPending(absPath);
  }

  return targets.length;
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
  giveUpSubs.clear();
}

module.exports = {
  writeCoalesced,
  getPending,
  cancelPending,
  flushPending,
  cancelPendingSubtree,
  flushPendingSubtree,
  flushAll,
  onFlushGiveUp,
  configure,
  _reset,
};
