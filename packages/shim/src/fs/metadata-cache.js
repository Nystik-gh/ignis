// In-memory metadata cache
// Populated from /api/fs/tree on startup, kept in sync via transport events.
// All stat/exists/readdir calls are served from this cache.

export class MetadataCache {
  constructor() {
    // Map<string, { type: 'file'|'directory', size: number, mtime: number, ctime: number }>
    this._entries = new Map();
  }

  // Populate from a server-provided tree object
  // tree shape: { "relative/path": { type, size, mtime, ctime }, ... }
  populate(tree) {
    this._entries.clear();
    for (const [path, meta] of Object.entries(tree)) {
      this._entries.set(this._normalize(path), meta);
    }
  }

  has(path) {
    return this._entries.has(this._normalize(path));
  }

  get(path) {
    return this._entries.get(this._normalize(path)) || null;
  }

  set(path, meta) {
    this._entries.set(this._normalize(path), meta);
  }

  delete(path) {
    this._entries.delete(this._normalize(path));
  }

  deleteSubtree(path) {
    const removed = this._subtree(this._normalize(path)).map(([key]) => key);

    for (const key of removed) {
      this._entries.delete(key);
    }

    return removed;
  }

  rename(oldPath, newPath) {
    const oldNorm = this._normalize(oldPath);
    const newNorm = this._normalize(newPath);

    if (oldNorm === newNorm) {
      return [];
    }

    const moved = this._subtree(oldNorm);
    const cleared = this.deleteSubtree(newNorm);

    for (const [key, val] of moved) {
      this._entries.delete(key);
      this._entries.set(newNorm + key.slice(oldNorm.length), val);
    }

    return cleared;
  }

  // List direct children of a directory path
  readdir(dirPath) {
    const norm = this._normalize(dirPath);
    const prefix = norm === "" ? "" : norm + "/";
    const results = [];
    const seen = new Set();

    for (const key of this._entries.keys()) {
      if (prefix === "" || key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const slashIdx = rest.indexOf("/");
        const childName = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;

        if (childName && !seen.has(childName)) {
          seen.add(childName);
          const childMeta = this._entries.get(prefix + childName);

          results.push({
            name: childName,
            type: childMeta?.type || (slashIdx >= 0 ? "directory" : "file"),
          });
        }
      }
    }
    return results;
  }

  get size() {
    return this._entries.size;
  }

  // Normalized keys of every entry, for callers that diff the cache against a fresh tree.
  keys() {
    return [...this._entries.keys()];
  }

  toStat(path) {
    const meta = this.get(path);

    if (!meta) {
      return null;
    }

    return {
      size: meta.size || 0,
      mtimeMs: meta.mtime || 0,
      ctimeMs: meta.mtime || 0, // ctimeMs (POSIX inode) must be set to mtime since meta.ctime is creation time not inode.
      atimeMs: meta.mtime || 0,
      birthtimeMs: meta.ctime || 0,
      mtime: new Date(meta.mtime || 0),
      ctime: new Date(meta.mtime || 0),
      atime: new Date(meta.mtime || 0),
      birthtime: new Date(meta.ctime || 0),
      isFile: () => meta.type === "file",
      isDirectory: () => meta.type === "directory",
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  _subtree(norm) {
    const prefix = norm + "/";

    return [...this._entries].filter(
      ([key]) => key === norm || key.startsWith(prefix),
    );
  }

  _normalize(p) {
    // Normalize slashes, remove leading and trailing slashes
    return (p || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }
}
