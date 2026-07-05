// Always-on write durability: a failed writeFile is retried with backoff.
// A non-silent write drives the status-bar dirty signal and fires a failure event on give-up; a silent write retries without surfacing.

import { markLocalOp } from "./echo-guard.js";

// Only a write lagging past this shows as pending.
const PENDING_AFTER_MS = 1000;

// Retry delays; the last repeats once exhausted.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

const MAX_ATTEMPTS = 8;

let transport = null;

// Retries reuse the same per-path serializer as fresh writes, so a stale retry cannot clobber a newer write.
let serialize = (path, run) => run();

// path -> { gen, status, silent, overThreshold, data, encoding, onResult, attempts, startTimer, retryTimer }
// status "inflight" | "retrying" | "failed"; a failed non-silent entry is kept out of the aggregate but retained for retryAll().
const entries = new Map();

// Bumped on every fresh write to a path, so a stale timer or settled promise from a superseded write bows out.
let genCounter = 0;

// "clean" | "pending". Failure is an event, not a state, so it never appears here.
let state = "clean";
const stateSubs = new Set();
const failureSubs = new Set();
const failureChangeSubs = new Set();

export function initWriteDurability(t, serializeFn) {
  transport = t;

  if (serializeFn) {
    serialize = serializeFn;
  }
}

function discard(path) {
  const entry = entries.get(path);

  if (!entry) {
    return;
  }

  clearTimeout(entry.startTimer);
  clearTimeout(entry.retryTimer);
  entries.delete(path);
}

// An entry still trying (in flight past the threshold, or retrying) contributes to "pending".
function contributesPending(entry) {
  if (entry.silent || entry.status === "failed") {
    return false;
  }

  return (
    entry.status === "retrying" ||
    (entry.status === "inflight" && entry.overThreshold)
  );
}

function recompute() {
  let next = "clean";

  for (const entry of entries.values()) {
    if (contributesPending(entry)) {
      next = "pending";
      break;
    }
  }

  if (next === state) {
    return;
  }

  state = next;

  for (const fn of stateSubs) {
    try {
      fn(state);
    } catch (e) {
      console.error("[shim:fs] write-durability subscriber threw:", e);
    }
  }
}

function emitFailure(path) {
  for (const fn of failureSubs) {
    try {
      fn(path);
    } catch (e) {
      console.error("[shim:fs] write-durability failure subscriber threw:", e);
    }
  }
}

function emitFailureChange() {
  for (const fn of failureChangeSubs) {
    try {
      fn();
    } catch (e) {
      console.error(
        "[shim:fs] write-durability failure-change subscriber threw:",
        e,
      );
    }
  }
}

function scheduleRetry(path, gen) {
  const entry = entries.get(path);

  if (!entry || entry.gen !== gen) {
    return;
  }

  const delay = BACKOFF_MS[Math.min(entry.attempts - 1, BACKOFF_MS.length - 1)];

  clearTimeout(entry.retryTimer);
  entry.retryTimer = setTimeout(() => attempt(path, gen), delay);
}

function attempt(path, gen) {
  const entry = entries.get(path);

  if (!entry || entry.gen !== gen || !transport) {
    return;
  }

  // Serialize behind any in-flight write; if a newer write superseded us while queued, skip the send.
  serialize(path, () => {
    const e = entries.get(path);

    if (!e || e.gen !== gen) {
      return Promise.resolve(null);
    }

    markLocalOp(path);
    return transport.writeFile(path, e.data, e.encoding);
  }).then(
    (result) => {
      const e = entries.get(path);

      if (!e || e.gen !== gen) {
        return;
      }

      if (e.onResult && result && result.mtime) {
        e.onResult(result);
      }

      discard(path);
      recompute();
    },
    () => {
      const e = entries.get(path);

      if (!e || e.gen !== gen) {
        return;
      }

      e.attempts += 1;

      if (e.attempts <= MAX_ATTEMPTS) {
        scheduleRetry(path, gen);
        return;
      }

      if (e.silent) {
        // Silent writes give up without user surfacing; the optimistic cache staleness clears on reload.
        console.error("[shim:fs] write durability gave up (silent):", path);
        discard(path);
        recompute();
      } else {
        e.status = "failed";
        recompute();
        emitFailure(path);
      }
    },
  );
}

// Track one write; the caller reports the outcome on the returned handle.
// The captured gen is checked on both outcome paths, so a superseded write never mutates a newer entry; opts.silent suppresses surfacing.
export function trackWrite(path, opts) {
  // A fresh write to a given-up path retires its failure, so any surface showing it must reconcile.
  const prev = entries.get(path);
  const supersededFailure = !!(
    prev &&
    prev.status === "failed" &&
    !prev.silent
  );

  discard(path);

  const gen = ++genCounter;
  const entry = {
    gen,
    status: "inflight",
    silent: !!(opts && opts.silent),
    overThreshold: false,
    startTimer: null,
    retryTimer: null,
  };

  entry.startTimer = setTimeout(() => {
    const e = entries.get(path);

    if (e && e.gen === gen && e.status === "inflight") {
      e.overThreshold = true;
      recompute();
    }
  }, PENDING_AFTER_MS);

  entries.set(path, entry);

  // Superseding a prior pending/retrying entry can clear the aggregate; the fresh write starts clean.
  recompute();

  if (supersededFailure) {
    emitFailureChange();
  }

  return {
    success() {
      const e = entries.get(path);

      if (e && e.gen === gen) {
        discard(path);
        recompute();
      }
    },

    failure(data, encoding, onResult) {
      const e = entries.get(path);

      if (!e || e.gen !== gen) {
        return;
      }

      clearTimeout(e.startTimer);
      e.data = data;
      e.encoding = encoding;
      e.onResult = onResult;
      e.status = "retrying";
      e.overThreshold = true;
      e.attempts = 1;

      scheduleRetry(path, gen);
      recompute();
    },
  };
}

export function getState() {
  return state;
}

export function onStateChange(handler) {
  stateSubs.add(handler);

  return () => {
    stateSubs.delete(handler);
  };
}

// Fires the path of each non-silent write that has permanently given up after exhausting its retries.
export function onFailure(handler) {
  failureSubs.add(handler);

  return () => {
    failureSubs.delete(handler);
  };
}

// Fires when a given-up path is retired by a newer write; read the current set via listFailed().
export function onFailureChange(handler) {
  failureChangeSubs.add(handler);

  return () => {
    failureChangeSubs.delete(handler);
  };
}

export function listFailed() {
  const failed = [];

  for (const [path, entry] of entries) {
    if (entry.status === "failed" && !entry.silent) {
      failed.push(path);
    }
  }

  return failed;
}

export function getDetail() {
  let pending = 0;
  let retrying = 0;

  for (const entry of entries.values()) {
    if (entry.silent || entry.status === "failed") {
      continue;
    }

    if (entry.status === "retrying") {
      retrying += 1;
      pending += 1;
    } else if (entry.status === "inflight" && entry.overThreshold) {
      pending += 1;
    }
  }

  return { pending, retrying };
}

export function retryAll() {
  for (const [path, entry] of entries) {
    if (entry.status === "failed" && !entry.silent) {
      entry.status = "retrying";
      entry.attempts = 1;
      attempt(path, entry.gen);
    }
  }

  recompute();
}

// Test-only: count of tracked entries.
export function _size() {
  return entries.size;
}

// Test-only: clear all timers, state, and subscribers.
export function _reset() {
  for (const entry of entries.values()) {
    clearTimeout(entry.startTimer);
    clearTimeout(entry.retryTimer);
  }

  entries.clear();
  state = "clean";
  genCounter = 0;
  serialize = (path, run) => run();
  stateSubs.clear();
  failureSubs.clear();
  failureChangeSubs.clear();
}
