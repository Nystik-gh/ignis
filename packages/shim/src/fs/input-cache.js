// Dedicated cache for files picked via browser file dialogs.
// Avoids server round trips for input-only files (e.g., importer plugin).
//
// - 200MB size limit (higher than content cache; import batches can be large)
// - 5-minute TTL per entry
// - Entries kept until TTL expires (plugins may read the same file multiple times)

const MAX_SIZE = 200 * 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // path -> { data, size, createdAt }
let currentSize = 0;

function normalize(p) {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function evictExpired() {
  const now = Date.now();

  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      currentSize -= entry.size;
      cache.delete(key);
    }
  }
}

function evictOldest() {
  let oldest = null;
  let oldestTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.createdAt < oldestTime) {
      oldest = key;
      oldestTime = entry.createdAt;
    }
  }

  if (oldest) {
    currentSize -= cache.get(oldest).size;
    cache.delete(oldest);
  }
}

export function inputCacheHas(path) {
  const norm = normalize(path);
  const entry = cache.get(norm);

  if (!entry) {
    return false;
  }

  if (Date.now() - entry.createdAt > TTL_MS) {
    currentSize -= entry.size;
    cache.delete(norm);
    return false;
  }

  return true;
}

export function inputCacheGet(path) {
  const norm = normalize(path);
  const entry = cache.get(norm);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > TTL_MS) {
    currentSize -= entry.size;
    cache.delete(norm);
    return null;
  }

  return entry.data;
}

export function inputCacheSet(path, data) {
  const norm = normalize(path);
  const size = data ? data.length || data.byteLength || 0 : 0;

  // Remove existing entry if replacing
  if (cache.has(norm)) {
    currentSize -= cache.get(norm).size;
    cache.delete(norm);
  }

  // Evict expired entries first
  evictExpired();

  // Evict oldest entries if still over limit
  while (currentSize + size > MAX_SIZE && cache.size > 0) {
    evictOldest();
  }

  cache.set(norm, { data, size, createdAt: Date.now() });
  currentSize += size;
}

export function inputCacheDelete(path) {
  const norm = normalize(path);
  const entry = cache.get(norm);

  if (entry) {
    currentSize -= entry.size;
    cache.delete(norm);
  }
}

export function inputCacheClear() {
  cache.clear();
  currentSize = 0;
}

export function isInputCachePath(path) {
  const norm = normalize(path);
  return norm.startsWith(".obsidian/imports/");
}
