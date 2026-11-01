// Always-on write durability: a failed writeFile is retried with backoff.
// A non-silent write drives the status-bar dirty signal and fires a failure event on give-up; a silent write retries without surfacing.

import { markSentOp } from "./echo-guard.js";
import { isPathInSubtree } from "../util/path.js";

// Only a write lagging past this shows as pending.
const PENDING_AFTER_MS = 1000;

// Retry delays; the last repeats once exhausted.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

const MAX_ATTEMPTS = 8;

let transport = null;
let listenersBound = false;
let silentByDefault = false;

// Retries reuse the same per-path serializer as fresh writes, so a stale retry cannot clobber a newer write.
let serialize = (path, run) => run();

// path -> { gen, status, silent, overThreshold, data, encoding, onResult, followUp, attempts, startTimer, retryTimer }
// status "inflight" | "retrying" | "failed"; a failed non-silent entry is kept out of the aggregate but retained for retryAll().
const entries = new Map();

const sendUnqueued = (path, run) => Promise.resolve().then(run);

// Bumped on every fresh write to a path, so a stale timer or settled promise from a superseded write bows out.
let genCounter = 0;

// "clean" | "pending". Failure is an event, not a state, so it never appears here.
let state = "clean";
const stateSubs = new Set();
const failureSubs = new Set();
const failureChangeSubs = new Set();

export function setSilentByDefault(on) {
  silentByDefault = !!on;
}

export function initWriteDurability(t, serializeFn) {
  transport = t;

  if (serializeFn) {
    serialize = serializeFn;
  }

  if (
    listenersBound ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }

  listenersBound = true;

  // Commit queued writes on pagehide.
  window.addEventListener("pagehide", flushOnUnload);

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushOnUnload();
      }
    });
  }
}

// Attempt every queued write.
function flushOnUnload() {
  if (!transport) {
    return;
  }

  for (const [path, entry] of entries) {
    if (entry.data === undefined || entry.data === null) {
      continue;
    }

    if (entry.status === "retrying") {
      clearTimeout(entry.retryTimer);
      attempt(path, entry.gen);
    } else if (entry.status === "failed") {
      entry.status = "retrying";
      entry.attempts = 1;
      attempt(path, entry.gen);
    }
  }

  recompute();
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

function attempt(path, gen, schedule = serialize) {
  const entry = entries.get(path);

  if (!entry || entry.gen !== gen || !transport) {
    return;
  }

  // Serialize behind any in-flight write; if a newer write superseded us while queued, skip the send.
  const writeAttempt = schedule(path, () => {
    const current = entries.get(path);

    if (!current || current.gen !== gen) {
      return Promise.resolve(null);
    }

    markSentOp(path);

    return transport
      .writeFile(path, current.data, current.encoding)
      .then((result) => {
        if (current.onResult && result && result.mtime) {
          current.onResult(result);
        }

        if (!current.followUp) {
          return result;
        }

        return Promise.resolve()
          .then(current.followUp)
          .catch(() => {})
          .then(() => result);
      });
  });

  writeAttempt.then(
    () => {
      const current = entries.get(path);

      if (!current || current.gen !== gen) {
        return;
      }

      discard(path);
      recompute();
    },
    () => {
      const current = entries.get(path);

      if (!current || current.gen !== gen) {
        return;
      }

      current.attempts += 1;

      if (current.attempts <= MAX_ATTEMPTS) {
        scheduleRetry(path, gen);
        return;
      }

      if (current.silent) {
        // Silent writes give up without user surfacing; the optimistic cache staleness clears on reload.
        console.error("[shim:fs] write durability gave up (silent):", path);
        discard(path);
        recompute();
      } else {
        current.status = "failed";
        recompute();
        emitFailure(path);
      }
    },
  );

  return writeAttempt;
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
  const inheritsSurfacing = !!(prev && !prev.silent);

  discard(path);

  const gen = ++genCounter;
  const entry = {
    gen,
    status: "inflight",
    silent: !inheritsSurfacing && (silentByDefault || !!(opts && opts.silent)),
    overThreshold: false,
    startTimer: null,
    retryTimer: null,
  };

  entry.startTimer = setTimeout(() => {
    const current = entries.get(path);

    if (current && current.gen === gen && current.status === "inflight") {
      current.overThreshold = true;
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
      const current = entries.get(path);

      if (current && current.gen === gen) {
        discard(path);
        recompute();
      }
    },

    failure(data, encoding, onResult) {
      const current = entries.get(path);

      if (!current || current.gen !== gen) {
        return;
      }

      clearTimeout(current.startTimer);
      current.data = data;
      current.encoding = encoding;
      current.onResult = onResult;
      current.status = "retrying";
      current.overThreshold = true;
      current.attempts = 1;

      scheduleRetry(path, gen);
      recompute();
    },
  };
}

export function attachFollowUp(path, fn) {
  const entry = entries.get(path);

  if (!entry || (entry.status !== "retrying" && entry.status !== "failed")) {
    return false;
  }

  entry.followUp = fn;

  return true;
}

export function dropRetries(path) {
  let retiredFailure = false;

  for (const [key, entry] of entries) {
    const awaitingRetry = entry.status !== "inflight";

    if (!awaitingRetry || !isPathInSubtree(key, path)) {
      continue;
    }

    retiredFailure ||= entry.status === "failed" && !entry.silent;
    discard(key);
  }

  recompute();

  if (retiredFailure) {
    emitFailureChange();
  }
}

export function retryNow(path) {
  const retries = [];
  let retiredFailure = false;

  for (const [key, entry] of entries) {
    const awaitingRetry = entry.status !== "inflight";

    if (!awaitingRetry || !isPathInSubtree(key, path)) {
      continue;
    }

    clearTimeout(entry.retryTimer);

    if (entry.status === "failed") {
      retiredFailure ||= !entry.silent;
      entry.status = "retrying";
      entry.attempts = 1;
    }

    // Retries occur in the active queue slot, so use sendUnqueued.
    retries.push(attempt(key, entry.gen, sendUnqueued));
  }

  recompute();

  if (retiredFailure) {
    emitFailureChange();
  }

  return Promise.all(retries);
}

export function hasWriteInProgress(path) {
  const entry = entries.get(path);

  return !!entry && entry.status !== "failed";
}

export function hasFailedWrite(path) {
  return entries.get(path)?.status === "failed";
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

// fn(path) runs when a non-silent write gives up permanently.
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

// Paths currently contributing to the "pending" aggregate.
export function listPending() {
  const pending = [];

  for (const [path, entry] of entries) {
    if (contributesPending(entry)) {
      pending.push(path);
    }
  }

  return pending;
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
  silentByDefault = false;
  serialize = (path, run) => run();
  stateSubs.clear();
  failureSubs.clear();
  failureChangeSubs.clear();
}
