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
  it.todo("populate() clears existing entries");
  it.todo("merge() preserves existing entries");
  it.todo("populate then merge -- pre-existing entries survive merge");
});

describe("MetadataCache toStat", () => {
  it.todo("returns correct shape with all expected fields and methods");
  it.todo("returns null for missing paths");
  it.todo("constructs dates from zero when mtime/ctime are missing");
});

describe("MetadataCache readdir", () => {
  it.todo("root readdir returns top-level entries");
  it.todo("nested dir returns only direct children, not grandchildren");
  it.todo(
    "readdir of foo does not include foobar entries (prefix false-match)",
  );
  it.todo("infers directory type for paths with no direct map entry");
  it.todo("returns empty array for path with no children");
  it.todo("returns empty array for nonexistent path");
});

describe("MetadataCache rename", () => {
  it.todo("rename file: old path gone, new path present with same metadata");
});
