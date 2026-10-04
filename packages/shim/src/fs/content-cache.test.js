import { describe, it, expect, vi } from "vitest";
import { ContentCache } from "./content-cache.js";

// -- Size accounting ---------------------------------------------------

describe("ContentCache size accounting", () => {
  it("set increases currentBytes by data length", () => {
    const cache = new ContentCache(1024);
    cache.set("a.md", "hello"); // 5 bytes
    expect(cache.currentBytes).toBe(5);
  });

  it("delete returns currentBytes to 0", () => {
    const cache = new ContentCache(1024);
    cache.set("a.md", "hello");
    cache.delete("a.md");
    expect(cache.currentBytes).toBe(0);
  });

  it("replacing an entry reflects the new size", () => {
    const cache = new ContentCache(1024);
    cache.set("a.md", "short");
    cache.set("a.md", "a much longer string");
    expect(cache.currentBytes).toBe("a much longer string".length);
  });

  it("deleting one of several entries leaves the sum of the rest", () => {
    const cache = new ContentCache(1024);
    cache.set("a.md", "aaa"); // 3
    cache.set("b.md", "bbbbb"); // 5
    cache.set("c.md", "cc"); // 2
    cache.delete("b.md");
    expect(cache.currentBytes).toBe(5); // 3 + 2
  });
});

// -- LRU eviction ------------------------------------------------------

describe("ContentCache LRU eviction", () => {
  it("evicts the least-recently-accessed entry when full", () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);

    const cache = new ContentCache(10);
    cache.set("a.md", "aaaa"); // 4
    cache.set("b.md", "bbbb"); // 4
    // At 8/10. Adding 4 more would exceed, so LRU (a.md) should be evicted.
    cache.set("c.md", "cccc"); // 4
    expect(cache.has("a.md")).toBe(false);
    expect(cache.has("b.md")).toBe(true);
    expect(cache.has("c.md")).toBe(true);

    vi.restoreAllMocks();
  });

  it("accessing an entry refreshes it so it survives eviction", () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);

    const cache = new ContentCache(10);
    cache.set("a.md", "aaaa"); // 4, accessedAt=1000
    cache.set("b.md", "bbbb"); // 4, accessedAt=1001
    // Touch a.md so b.md becomes the LRU
    cache.get("a.md"); // a.md accessedAt=1002
    cache.set("c.md", "cccc"); // 4, should evict b.md (1001), not a.md (1002)
    expect(cache.has("a.md")).toBe(true);
    expect(cache.has("b.md")).toBe(false);
    expect(cache.has("c.md")).toBe(true);

    vi.restoreAllMocks();
  });

  it("keeps currentBytes accurate when replacing the LRU entry evicts", () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);

    const cache = new ContentCache(12);
    cache.set("a.md", "aaaa"); // 4
    cache.set("b.md", "bbbb"); // 4
    cache.set("c.md", "cccc"); // 4
    cache.get("b.md");
    cache.get("c.md");

    cache.set("a.md", "aaaaa"); // 5, a.md is the LRU

    expect(cache.has("a.md")).toBe(true);
    expect(cache.has("b.md")).toBe(false);
    expect(cache.size).toBe(2);
    expect(cache.currentBytes).toBe(9); // c (4) + a (5)

    for (let i = 0; i < 5; i++) {
      cache.set("a.md", "aaaaa");
    }

    expect(cache.currentBytes).toBe(9);

    vi.restoreAllMocks();
  });

  it("entry larger than maxSize still gets stored", () => {
    const cache = new ContentCache(5);
    cache.set("small.md", "ab"); // 2
    cache.set("big.md", "abcdefghij"); // 10, larger than maxSize
    expect(cache.has("small.md")).toBe(false);
    expect(cache.has("big.md")).toBe(true);
    expect(cache.currentBytes).toBe(10);
  });
});

// -- Path normalization ------------------------------------------------

describe("ContentCache path normalization", () => {
  it("backslash and slash variants hit the same cache entry", () => {
    const cache = new ContentCache(1024);
    cache.set("foo\\bar\\baz.md", "content");
    expect(cache.has("foo/bar/baz.md")).toBe(true);
    expect(cache.get("foo/bar/baz.md")).toBe("content");
  });
});

// -- Configured capacity -----------------------------------------------

describe("ContentCache maxSize", () => {
  it("reports the size passed to the constructor", () => {
    const cache = new ContentCache(7 * 1024);
    expect(cache.maxSize).toBe(7 * 1024);
  });

  it("reflects a later setMaxSize", () => {
    const cache = new ContentCache(1024);
    cache.setMaxSize(64 * 1024);
    expect(cache.maxSize).toBe(64 * 1024);
  });
});

// -- Server content ------------------------------------------------------

describe("ContentCache server content", () => {
  it("stores a fetched result when the path is unchanged since the fetch began", () => {
    const cache = new ContentCache(1024);
    const updatesBefore = cache.pathUpdates("a.md");

    expect(cache.setFromServer("a.md", "server", updatesBefore)).toBe(true);
    expect(cache.get("a.md")).toBe("server");
  });

  it("drops a fetched result when the path was written during the fetch", () => {
    const cache = new ContentCache(1024);
    const updatesBefore = cache.pathUpdates("a.md");

    cache.set("a.md", "local");

    expect(cache.setFromServer("a.md", "server", updatesBefore)).toBe(false);
    expect(cache.get("a.md")).toBe("local");
  });

  it("drops a fetched result when the path was invalidated during the fetch", () => {
    const cache = new ContentCache(1024);

    cache.set("a.md", "old");

    const updatesBefore = cache.pathUpdates("a.md");

    cache.invalidate("a.md");

    expect(cache.setFromServer("a.md", "server", updatesBefore)).toBe(false);
    expect(cache.has("a.md")).toBe(false);
  });

  it("never replaces cached content with a fetched result", () => {
    const cache = new ContentCache(1024);

    cache.set("a.md", "local");

    expect(
      cache.setFromServer("a.md", "server", cache.pathUpdates("a.md")),
    ).toBe(false);
    expect(cache.get("a.md")).toBe("local");
  });

  it("matches path updates across path spellings", () => {
    const cache = new ContentCache(1024);
    const updatesBefore = cache.pathUpdates("dir/a.md");

    cache.set("dir\\a.md", "local");

    expect(cache.setFromServer("/dir/a.md", "server", updatesBefore)).toBe(
      false,
    );
  });
});

// -- Retained entries ----------------------------------------------------

describe("ContentCache retained entries", () => {
  it("evicts the oldest entry that is not retained", () => {
    const cache = new ContentCache(10);

    cache.retainWhile((path) => path === "a.md");
    cache.set("a.md", "aaaa");
    cache.set("b.md", "bbbb");
    cache.set("c.md", "cccc");

    expect(cache.has("a.md")).toBe(true);
    expect(cache.has("b.md")).toBe(false);
    expect(cache.has("c.md")).toBe(true);
  });

  it("stores past the limit when every entry is retained", () => {
    const cache = new ContentCache(10);

    cache.retainWhile(() => true);
    cache.set("a.md", "aaaaaa");
    cache.set("b.md", "bbbbbb");

    expect(cache.has("a.md")).toBe(true);
    expect(cache.has("b.md")).toBe(true);
    expect(cache.currentBytes).toBe(12);
  });

  it("evicts a formerly retained entry once it is released", () => {
    const retained = new Set(["a.md"]);
    const cache = new ContentCache(10);

    cache.retainWhile((path) => retained.has(path));
    cache.set("a.md", "aaaaaa");
    retained.delete("a.md");
    cache.set("b.md", "bbbbbb");

    expect(cache.has("a.md")).toBe(false);
    expect(cache.has("b.md")).toBe(true);
  });
});
