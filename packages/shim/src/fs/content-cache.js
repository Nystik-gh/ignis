// In-memory content cache with simple LRU eviction
// Stores file content fetched from the server.

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export class ContentCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._cache = new Map(); // path -> { data, size, accessedAt }
    this._currentSize = 0;
    this._maxSize = maxSize;
    this._pathUpdates = new Map(); // path -> counter of times content was set or dropped
    this._isRetained = () => false;
  }

  retainWhile(isRetained) {
    this._isRetained = isRetained;
  }

  setMaxSize(maxSize) {
    this._maxSize = maxSize;

    while (this._currentSize > this._maxSize) {
      if (!this._evictOne()) {
        break;
      }
    }
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

  pathUpdates(path) {
    return this._pathUpdates.get(this._normalize(path)) || 0;
  }

  set(path, data) {
    const norm = this._normalize(path);

    this._store(norm, data);
    this._bump(norm);
  }

  setFromServer(path, data, pathUpdatesBeforeFetch) {
    const norm = this._normalize(path);

    // only fill empty cache entries that have not been set or dropped in the interim.
    if (
      this._cache.has(norm) ||
      this.pathUpdates(norm) !== pathUpdatesBeforeFetch
    ) {
      return false;
    }

    this._store(norm, data);

    return true;
  }

  delete(path) {
    const norm = this._normalize(path);

    this._remove(norm);
    this._bump(norm);
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

  get maxSize() {
    return this._maxSize;
  }

  _store(norm, data) {
    const size = data ? data.length || data.byteLength || 0 : 0;

    // Remove old entry if replacing
    this._remove(norm);

    // Evict LRU entries if needed
    while (this._currentSize + size > this._maxSize) {
      if (!this._evictOne()) {
        break;
      }
    }

    this._cache.set(norm, { data, size, accessedAt: Date.now() });
    this._currentSize += size;
  }

  _remove(norm) {
    const entry = this._cache.get(norm);

    if (entry) {
      this._currentSize -= entry.size;
      this._cache.delete(norm);
    }
  }

  _bump(norm) {
    this._pathUpdates.set(norm, this.pathUpdates(norm) + 1);
  }

  _evictOne() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this._cache) {
      if (entry.accessedAt < oldestTime && !this._isRetained(key)) {
        oldest = key;
        oldestTime = entry.accessedAt;
      }
    }

    if (oldest === null) {
      return false;
    }

    this._remove(oldest);

    return true;
  }

  _normalize(p) {
    return (p || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }
}
