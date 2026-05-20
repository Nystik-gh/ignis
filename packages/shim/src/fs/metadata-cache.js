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

  // Rename: move metadata from old path to new path (and children if directory)
  rename(oldPath, newPath) {
    const oldNorm = this._normalize(oldPath);
    const newNorm = this._normalize(newPath);
    const meta = this._entries.get(oldNorm);

    if (meta) {
      this._entries.delete(oldNorm);
      this._entries.set(newNorm, meta);
    }

    // Move children
    const prefix = oldNorm + "/";
    for (const [key, val] of this._entries) {
      if (key.startsWith(prefix)) {
        const newKey = newNorm + "/" + key.slice(prefix.length);
        this._entries.delete(key);
        this._entries.set(newKey, val);
      }
    }
  }

  // List direct children of a directory path
  readdir(dirPath) {
    const norm = this._normalize(dirPath);
    const prefix = norm === "" ? "" : norm + "/";
    const results = [];
    const seen = new Set();

    for (const [key, meta] of this._entries) {
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

  // Merge entries from a subtree without clearing existing data
  merge(tree) {
    for (const [path, meta] of Object.entries(tree)) {
      this._entries.set(this._normalize(path), meta);
    }
  }

  get size() {
    return this._entries.size;
  }

  toStat(path) {
    const meta = this.get(path);

    if (!meta) {
      return null;
    }

    return {
      size: meta.size || 0,
      mtimeMs: meta.mtime || 0,
      ctimeMs: meta.ctime || 0,
      atimeMs: meta.mtime || 0,
      birthtimeMs: meta.ctime || 0,
      mtime: new Date(meta.mtime || 0),
      ctime: new Date(meta.ctime || 0),
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

  _normalize(p) {
    // Normalize slashes, remove leading and trailing slashes
    return (p || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }
}
