// Coalesces boot-window writes per path so they flush in a few round-trips instead of one per save.

import { markLocalOp } from "./echo-guard.js";
import { trackWrite } from "./write-durability.js";

const QUIET_MS = 100; // flush a path this long after its last write
const MAX_WAIT_MS = 2000; // but never hold a buffered write longer than this

// Bodies over transport's keepalive cap would not survive a pagehide flush, so they are not coalesced.
export const COALESCE_MAX_BYTES = 32 * 1024;

let transport = null;
let listenersBound = false;
const pending = new Map(); // path -> { data, encoding, onResult, quiet, max }
const tails = new Map(); // path -> promise serializing that path's in-flight write

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

  // Deliver buffered writes if the tab is closed or hidden mid-boot.
  window.addEventListener("pagehide", flushAll);

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushAll();
      }
    });
  }
}

function performWrite(path, data, encoding, onResult) {
  markLocalOp(path);
  const track = trackWrite(path);

  return transport.writeFile(path, data, encoding).then(
    (result) => {
      track.success();

      if (result && result.mtime && onResult) {
        onResult(result);
      }

      return result;
    },
    (err) => {
      // put the failed write in the durability queue, which retries it in the background.
      track.failure(data, encoding, onResult);
      throw err;
    },
  );
}

// Run a write only after any in-flight write to the same path completes.
export function enqueue(path, run) {
  const prev = tails.get(path) || Promise.resolve();
  const result = prev.then(run, run);
  const tail = result.catch(() => {});

  tails.set(path, tail);
  tail.then(() => {
    if (tails.get(path) === tail) {
      tails.delete(path);
    }
  });

  return result;
}

function doFlush(path) {
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
  entry.quiet = setTimeout(() => doFlush(path), QUIET_MS);

  if (!entry.max) {
    entry.max = setTimeout(() => doFlush(path), MAX_WAIT_MS);
  }

  pending.set(path, entry);
}

export function enqueueWrite(path, data, encoding, onResult) {
  return enqueue(path, () => performWrite(path, data, encoding, onResult));
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

function flushAll() {
  for (const path of Array.from(pending.keys())) {
    doFlush(path);
  }
}
