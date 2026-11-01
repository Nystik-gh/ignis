// Track file operations sent to server.
import { normalize } from "../util/path.js";

const ECHO_SUPPRESS_MS = 1500;
const recentOps = new Map(); // normalized path -> timestamp
// Number of sent operations at the last time we marked.
const sentOpsAtLastMark = new Map();

let sentOps = 0;

export function markSentOp(path) {
  const norm = normalize(path);

  recentOps.set(norm, Date.now());
  sentOps++;
  sentOpsAtLastMark.set(norm, sentOps);
}

export function sentOpCount() {
  return sentOps;
}

export function markedSince(count) {
  const marked = [];

  for (const [path, sentOpsAtMark] of sentOpsAtLastMark) {
    if (sentOpsAtMark > count) {
      marked.push(path);
    }
  }

  return marked;
}

export function isRecentSentOp(path) {
  const norm = normalize(path);
  const ts = recentOps.get(norm);

  if (!ts) return false;

  if (Date.now() - ts < ECHO_SUPPRESS_MS) {
    return true;
  }

  recentOps.delete(norm);
  return false;
}
