// Shared echo suppression for file watcher.
// fs operations mark paths as "locally modified" so the watcher client
// can skip events that originated from this client.

const ECHO_SUPPRESS_MS = 1500;
const recentOps = new Map(); // normalized path -> timestamp

function normalize(p) {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function markLocalOp(path) {
  recentOps.set(normalize(path), Date.now());
}

export function isRecentLocalOp(path) {
  const norm = normalize(path);
  const ts = recentOps.get(norm);

  if (!ts) return false;

  if (Date.now() - ts < ECHO_SUPPRESS_MS) {
    return true;
  }

  recentOps.delete(norm);
  return false;
}
