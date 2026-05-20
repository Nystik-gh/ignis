import { describe, it, expect } from "vitest";
import { MetadataCache } from "./metadata-cache.js";

// -- Path normalization ----------------------------------------------

describe("MetadataCache path normalization", () => {
  it("converts backslashes to forward slashes", () => {
    const cache = new MetadataCache();
    cache.set("foo\\bar\\baz.md", { type: "file", size: 10 });
    expect(cache.has("foo/bar/baz.md")).toBe(true);
  });

  it("strips leading and trailing slashes", () => {
    const cache = new MetadataCache();
    cache.set("/foo/bar/", { type: "file", size: 10 });
    expect(cache.has("foo/bar")).toBe(true);
  });

  it("handles null and undefined as empty string", () => {
    const cache = new MetadataCache();
    cache.set(null, { type: "directory", size: 0 });
    expect(cache.has("")).toBe(true);
    expect(cache.has(undefined)).toBe(true);
  });

  it("normalizes //foo\\\\bar// to foo/bar", () => {
    const cache = new MetadataCache();
    cache.set("//foo\\bar//", { type: "file", size: 5 });
    expect(cache.has("foo/bar")).toBe(true);
  });
});

// -- Operations ------------------------------------------------------

describe("MetadataCache populate and merge", () => {
  it("populate() clears existing entries", () => {
    const cache = new MetadataCache();
    cache.set("old.md", { type: "file", size: 1 });
    cache.populate({ "new.md": { type: "file", size: 2 } });
    expect(cache.has("old.md")).toBe(false);
    expect(cache.has("new.md")).toBe(true);
  });

  it("merge() preserves existing entries", () => {
    const cache = new MetadataCache();
    cache.set("existing.md", { type: "file", size: 1 });
    cache.merge({ "added.md": { type: "file", size: 2 } });
    expect(cache.has("existing.md")).toBe(true);
    expect(cache.has("added.md")).toBe(true);
  });

  it("populate then merge -- pre-existing entries survive merge", () => {
    const cache = new MetadataCache();
    cache.populate({
      "a.md": { type: "file", size: 1 },
      "b.md": { type: "file", size: 2 },
    });
    cache.merge({ "c.md": { type: "file", size: 3 } });
    expect(cache.has("a.md")).toBe(true);
    expect(cache.has("b.md")).toBe(true);
    expect(cache.has("c.md")).toBe(true);
  });
});

describe("MetadataCache toStat", () => {
  it("returns correct shape with all expected fields and methods", () => {
    const cache = new MetadataCache();
    cache.set("file.md", { type: "file", size: 42, mtime: 1000, ctime: 2000 });
    const stat = cache.toStat("file.md");

    expect(stat.size).toBe(42);
    expect(stat.mtimeMs).toBe(1000);
    expect(stat.ctimeMs).toBe(2000);
    expect(stat.atimeMs).toBe(1000);
    expect(stat.birthtimeMs).toBe(2000);
    expect(stat.mtime).toEqual(new Date(1000));
    expect(stat.ctime).toEqual(new Date(2000));
    expect(stat.atime).toEqual(new Date(1000));
    expect(stat.birthtime).toEqual(new Date(2000));
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isBlockDevice()).toBe(false);
    expect(stat.isCharacterDevice()).toBe(false);
    expect(stat.isFIFO()).toBe(false);
    expect(stat.isSocket()).toBe(false);
  });

  it("returns null for missing paths", () => {
    const cache = new MetadataCache();
    expect(cache.toStat("nonexistent.md")).toBe(null);
  });

  it("constructs dates from zero when mtime/ctime are missing", () => {
    const cache = new MetadataCache();
    cache.set("bare.md", { type: "file", size: 1 });
    const stat = cache.toStat("bare.md");

    expect(stat.mtimeMs).toBe(0);
    expect(stat.ctimeMs).toBe(0);
    expect(stat.mtime).toEqual(new Date(0));
    expect(stat.ctime).toEqual(new Date(0));
  });
});

describe("MetadataCache readdir", () => {
  function populated() {
    const cache = new MetadataCache();
    cache.populate({
      "foo/bar.md": { type: "file", size: 1 },
      "foo/baz.md": { type: "file", size: 2 },
      "foo/sub/deep.md": { type: "file", size: 3 },
      "foobar/other.md": { type: "file", size: 4 },
      "root.md": { type: "file", size: 5 },
      "docs": { type: "directory", size: 0 },
    });
    return cache;
  }

  it("root readdir returns top-level entries", () => {
    const cache = populated();
    const entries = cache.readdir("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["docs", "foo", "foobar", "root.md"]);
  });

  it("nested dir returns only direct children, not grandchildren", () => {
    const cache = populated();
    const entries = cache.readdir("foo");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["bar.md", "baz.md", "sub"]);
    expect(names).not.toContain("deep.md");
  });

  it("readdir of foo does not include foobar entries (prefix false-match)", () => {
    const cache = populated();
    const entries = cache.readdir("foo");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain("foobar");
    expect(names).not.toContain("other.md");
  });

  it("infers directory type for paths with no direct map entry", () => {
    const cache = populated();
    const entries = cache.readdir("foo");
    const sub = entries.find((e) => e.name === "sub");
    expect(sub).toBeDefined();
    expect(sub.type).toBe("directory");
  });

  it("returns empty array for path with no children", () => {
    const cache = populated();
    const entries = cache.readdir("docs");
    expect(entries).toEqual([]);
  });

  it("returns empty array for nonexistent path", () => {
    const cache = populated();
    const entries = cache.readdir("nope/not/here");
    expect(entries).toEqual([]);
  });
});

describe("MetadataCache rename", () => {
  it("rename file: old path gone, new path present with same metadata", () => {
    const cache = new MetadataCache();
    const meta = { type: "file", size: 10, mtime: 100 };
    cache.set("a.md", meta);
    cache.rename("a.md", "b.md");

    expect(cache.has("a.md")).toBe(false);
    expect(cache.has("b.md")).toBe(true);
    expect(cache.get("b.md")).toBe(meta);
  });

  it("rename directory moves all children", () => {
    const cache = new MetadataCache();
    const dirMeta = { type: "directory", size: 0 };
    const fileMeta = { type: "file", size: 5 };
    const deepMeta = { type: "file", size: 8 };
    cache.set("a", dirMeta);
    cache.set("a/file.md", fileMeta);
    cache.set("a/sub/deep.md", deepMeta);
    cache.rename("a", "b");

    expect(cache.has("a")).toBe(false);
    expect(cache.has("a/file.md")).toBe(false);
    expect(cache.has("a/sub/deep.md")).toBe(false);
    expect(cache.get("b")).toBe(dirMeta);
    expect(cache.get("b/file.md")).toBe(fileMeta);
    expect(cache.get("b/sub/deep.md")).toBe(deepMeta);
  });

  it("rename where old and new share a common prefix", () => {
    const cache = new MetadataCache();
    const meta = { type: "file", size: 1 };
    cache.set("a/b", meta);
    cache.rename("a/b", "a/c");

    expect(cache.has("a/b")).toBe(false);
    expect(cache.get("a/c")).toBe(meta);
  });

  it("rename to a deeper nesting level", () => {
    const cache = new MetadataCache();
    const meta = { type: "file", size: 1 };
    cache.set("x", meta);
    cache.rename("x", "y/z");

    expect(cache.has("x")).toBe(false);
    expect(cache.get("y/z")).toBe(meta);
  });
});
