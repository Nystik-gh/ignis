// Coalesces boot-window writes per path so they flush in a few round-trips instead of one per save.

import { markSentOp } from "./echo-guard.js";
import {
  dropRetries,
  hasWriteInProgress,
  retryNow,
  trackWrite,
} from "./write-durability.js";
import { isPathInSubtree, normalize } from "../util/path.js";

const QUIET_MS = 100; // flush a path this long after its last write
const MAX_WAIT_MS = 2000; // but never hold a buffered write longer than this

// Bodies over transport's keepalive cap would not survive a pagehide flush, so they are not coalesced.
export const COALESCE_MAX_BYTES = 32 * 1024;

let transport = null;
let listenersBound = false;
const pending = new Map(); // path -> { data, encoding, onResult, quiet, max }
const tails = new Map(); // path -> promise of the last operation queued on that path

// Set by init.js on the bootstrap path, cleared at layout-ready.
export function isBooting() {
  return typeof window !== "undefined" && window.__ignisBooting === true;
}

export function initWriteCoalescer(t) {
  transport = t;

  if (
    listenersBound ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }

  listenersBound = true;

  // Commit buffered writes on pagehide.
  window.addEventListener("pagehide", flushAll);

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushAll();
      }
    });
  }
}

function performWrite(path, data, encoding, onResult, opts) {
  markSentOp(path);
  const track = trackWrite(path, opts);

  return transport.writeFile(path, data, encoding).then(
    (result) => {
      track.success();

      if (result && result.mtime && onResult) {
        onResult(result);
      }

      return result;
    },
    (err) => {
      track.failure(data, encoding, onResult, err);
      throw err;
    },
  );
}

function setTail(path, tail) {
  tails.set(path, tail);
  tail.then(() => {
    if (tails.get(path) === tail) {
      tails.delete(path);
    }
  });
}

function ancestorTails(path) {
  const found = [];

  for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) {
    const tail = tails.get(path.slice(0, i));

    if (tail) {
      found.push(tail);
    }
  }

  return found;
}

function whenAll(promises) {
  if (promises.length <= 1) {
    return promises[0] || Promise.resolve();
  }

  return Promise.all(promises);
}

// Queue a write on the specified path, queued after existing operations on the path or ancestor paths.
export function enqueue(path, run) {
  const prev = whenAll(
    [tails.get(path), ...ancestorTails(path)].filter(Boolean),
  );
  const result = prev.then(run, run);
  const tail = result.catch(() => {});

  setTail(path, tail);

  return result;
}

export function enqueueMutation(
  paths,
  run,
  { supersededPaths = [], dependentPaths = [] } = {},
) {
  const touches = (key) => paths.some((path) => isPathInSubtree(key, path));

  for (const key of Array.from(pending.keys())) {
    if (touches(key)) {
      flushPending(key);
    }
  }

  const writes = paths.flatMap(ancestorTails);

  for (const [key, tail] of tails) {
    if (touches(key)) {
      writes.push(tail);
    }
  }

  const result = Promise.all(writes)
    .then(() => Promise.all(dependentPaths.map(retryNow)))
    .then(run)
    .then((value) => {
      for (const path of supersededPaths) {
        dropRetries(path);
      }

      return value;
    });
  const tail = result.catch(() => {});

  for (const path of paths) {
    setTail(path, tail);
  }

  return result;
}

function flushPending(path) {
  const entry = pending.get(path);

  if (!entry) {
    return;
  }

  clearTimeout(entry.quiet);
  clearTimeout(entry.max);
  pending.delete(path);

  enqueue(path, () =>
    performWrite(path, entry.data, entry.encoding, entry.onResult),
  ).catch(() => {
    // performWrite handed the failure to the durability queue; nothing more to do here.
  });
}

export function bufferWrite(path, data, encoding, onResult) {
  const entry = pending.get(path) || { max: null };

  clearTimeout(entry.quiet);
  entry.data = data;
  entry.encoding = encoding;
  entry.onResult = onResult;
  entry.quiet = setTimeout(() => flushPending(path), QUIET_MS);

  if (!entry.max) {
    entry.max = setTimeout(() => flushPending(path), MAX_WAIT_MS);
  }

  pending.set(path, entry);
}

export function enqueueWrite(path, data, encoding, onResult, opts) {
  return enqueue(path, () =>
    performWrite(path, data, encoding, onResult, opts),
  );
}

export function cancelPending(path) {
  const entry = pending.get(path);

  if (!entry) {
    return;
  }

  clearTimeout(entry.quiet);
  clearTimeout(entry.max);
  pending.delete(path);
}

export function hasPending(path) {
  return pending.has(path);
}

export function whenIdle(path) {
  const norm = normalize(path);

  return whenAll([tails.get(norm), ...ancestorTails(norm)].filter(Boolean));
}

export function hasUnconfirmedWrite(path) {
  const norm = normalize(path);

  return (
    pending.has(norm) ||
    tails.has(norm) ||
    ancestorTails(norm).length > 0 ||
    hasWriteInProgress(norm)
  );
}

function flushAll() {
  for (const path of Array.from(pending.keys())) {
    flushPending(path);
  }
}

// Test-only: drop buffered writes and per-path tails.
export function _reset() {
  for (const entry of pending.values()) {
    clearTimeout(entry.quiet);
    clearTimeout(entry.max);
  }

  pending.clear();
  tails.clear();
}
