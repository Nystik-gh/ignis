// In-memory content cache with simple LRU eviction
// Stores file content fetched from the server.

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export class ContentCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._cache = new Map(); // path -> { data, size, accessedAt }
    this._currentSize = 0;
    this._maxSize = maxSize;
  }

  has(path) {
    return this._cache.has(this._normalize(path));
  }

  get(path) {
    const entry = this._cache.get(this._normalize(path));
    if (entry) {
      entry.accessedAt = Date.now();
      return entry.data;
    }

    return null;
  }

  set(path, data) {
    const norm = this._normalize(path);
    const size = data ? data.length || data.byteLength || 0 : 0;

    // Remove old entry if replacing
    if (this._cache.has(norm)) {
      this._currentSize -= this._cache.get(norm).size;
    }

    // Evict LRU entries if needed
    while (this._currentSize + size > this._maxSize && this._cache.size > 0) {
      this._evictOne();
    }

    this._cache.set(norm, { data, size, accessedAt: Date.now() });
    this._currentSize += size;
  }

  delete(path) {
    const norm = this._normalize(path);
    const entry = this._cache.get(norm);

    if (entry) {
      this._currentSize -= entry.size;
      this._cache.delete(norm);
    }
  }

  // Invalidate a path (remove from cache so next read fetches fresh)
  invalidate(path) {
    this.delete(path);
  }

  clear() {
    this._cache.clear();
    this._currentSize = 0;
  }

  get size() {
    return this._cache.size;
  }

  get currentBytes() {
    return this._currentSize;
  }

  _evictOne() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this._cache) {
      if (entry.accessedAt < oldestTime) {
        oldest = key;
        oldestTime = entry.accessedAt;
      }
    }

    if (oldest) {
      this.delete(oldest);
    }
  }

  _normalize(p) {
    return (p || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }
}
