import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prefetchVaultContent } from "./indexer-prefetch.js";

const MB = 1024 * 1024;

// Every selection rule.
const tree = {
  ".obsidian/app.json": { type: "file", size: 100 },
  ".obsidian/community-plugins.json": { type: "file", size: 50 },
  ".obsidian/plugins/big/main.js": { type: "file", size: 2 * MB },
  ".obsidian/plugins/big/manifest.json": { type: "file", size: 80 },
  ".obsidian/plugins/big/styles.css": { type: "file", size: 200 },
  ".obsidian/plugins/big/data.json": { type: "file", size: 300 * 1024 },
  "Note.md": { type: "file", size: 100 },
  "Big.md": { type: "file", size: 600 * 1024 },
  "plugins/fake/main.js": { type: "file", size: 100 },
  somedir: { type: "directory" },
};

// Total bytes of the priority-slice files.
const PRIORITY_BYTES = 100 + 50 + 2 * MB + 80 + 200 + 300 * 1024;

let fetchCalls;

function makeCache() {
  const store = new Map();
  return { store, set: (path, content) => store.set(path, content) };
}

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const paths = JSON.parse(init.body).paths;
    fetchCalls.push(paths);

    const files = {};

    for (const p of paths) {
      files[p] = "content:" + p;
    }

    return { ok: true, json: async () => ({ files }) };
  });
});

afterEach(() => {
  delete globalThis.fetch;
  vi.restoreAllMocks();
});

describe("prefetchVaultContent slicing", () => {
  it("fetches the priority slice before the bulk slice", async () => {
    const result = prefetchVaultContent("v", tree, makeCache());
    await result.bulk;

    expect(fetchCalls.length).toBe(2);
    const [priorityPaths, bulkPaths] = fetchCalls;

    expect(priorityPaths).toEqual(
      expect.arrayContaining([
        ".obsidian/app.json",
        ".obsidian/community-plugins.json",
        ".obsidian/plugins/big/main.js",
        ".obsidian/plugins/big/manifest.json",
        ".obsidian/plugins/big/styles.css",
      ]),
    );
    expect(priorityPaths).not.toContain("Note.md");

    expect(bulkPaths).toEqual(
      expect.arrayContaining(["Note.md", "plugins/fake/main.js"]),
    );
  });

  it("anchors the plugin predicate to .obsidian, so a bare plugins/ path is bulk", async () => {
    const result = prefetchVaultContent("v", tree, makeCache());
    await result.bulk;

    expect(fetchCalls[0]).not.toContain("plugins/fake/main.js");
    expect(fetchCalls[1]).toContain("plugins/fake/main.js");
  });

  it("promotes plugin data.json into the priority slice", async () => {
    const result = prefetchVaultContent("v", tree, makeCache());
    await result.bulk;

    expect(fetchCalls[0]).toContain(".obsidian/plugins/big/data.json");
    expect(fetchCalls[1]).not.toContain(".obsidian/plugins/big/data.json");
  });

  it("admits core entry files before data.json, so a large data.json cannot crowd out a core file", async () => {
    // A 12 MB cache yields a 9 MB budget; the three 3 MB main.js fill it, leaving no room for the 3 MB data.json.
    const t = {
      ".obsidian/plugins/a/main.js": { type: "file", size: 3 * MB },
      ".obsidian/plugins/b/main.js": { type: "file", size: 3 * MB },
      ".obsidian/plugins/c/main.js": { type: "file", size: 3 * MB },
      ".obsidian/plugins/a/data.json": { type: "file", size: 3 * MB },
    };

    const cache = { ...makeCache(), maxSize: 12 * MB };
    const result = prefetchVaultContent("v", t, cache);
    await result.bulk;

    expect(fetchCalls[0]).toEqual(
      expect.arrayContaining([
        ".obsidian/plugins/a/main.js",
        ".obsidian/plugins/b/main.js",
        ".obsidian/plugins/c/main.js",
      ]),
    );
    expect(fetchCalls[0]).not.toContain(".obsidian/plugins/a/data.json");
  });

  it("caps the priority slice at the cache-derived budget", async () => {
    // A 12 MB cache yields a 9 MB budget; two 4 MB entry files fit, the third is dropped.
    const bigTree = {
      ".obsidian/plugins/a/main.js": { type: "file", size: 4 * MB },
      ".obsidian/plugins/b/main.js": { type: "file", size: 4 * MB },
      ".obsidian/plugins/c/main.js": { type: "file", size: 4 * MB },
    };

    const cache = { ...makeCache(), maxSize: 12 * MB };
    const result = prefetchVaultContent("v", bigTree, cache);
    await result.bulk;

    expect(fetchCalls[0].length).toBe(2);
  });

  it("warms all plugin bundles into priority when the cache budget allows", async () => {
    // Six 3 MB plugin bundles is 18 MB of boot-critical files; the default ~37 MB budget admits them all.
    const t = {};

    for (const p of ["a", "b", "c", "d", "e", "f"]) {
      t[".obsidian/plugins/" + p + "/main.js"] = { type: "file", size: 3 * MB };
    }

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    expect(fetchCalls[0].length).toBe(6);
  });

  it("drops a bulk file over the 512KB per-file cap", async () => {
    const result = prefetchVaultContent("v", tree, makeCache());
    await result.bulk;

    expect(fetchCalls.flat()).not.toContain("Big.md");
  });

  it("reports priority byte progress from zero up to the slice total", async () => {
    const onProgress = vi.fn();
    const result = prefetchVaultContent("v", tree, makeCache(), { onProgress });
    await result.priority;

    expect(onProgress).toHaveBeenCalledWith(0, PRIORITY_BYTES);
    expect(onProgress).toHaveBeenLastCalledWith(PRIORITY_BYTES, PRIORITY_BYTES);
  });

  it("caches returned content under its path", async () => {
    const cache = makeCache();
    const result = prefetchVaultContent("v", tree, cache);
    await result.bulk;

    expect(cache.store.get(".obsidian/app.json")).toBe(
      "content:.obsidian/app.json",
    );
    expect(cache.store.get("Note.md")).toBe("content:Note.md");
  });

  it("resolves both promises without fetching when there is no vault", async () => {
    const result = prefetchVaultContent("", tree, makeCache());

    await result.priority;
    await result.bulk;

    expect(fetchCalls.length).toBe(0);
  });

  it("resolves the priority promise even when a batch fails", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));

    const result = prefetchVaultContent("v", tree, makeCache());

    await expect(result.priority).resolves.toBeUndefined();
  });
});

describe("prefetchVaultContent parallel batching", () => {
  it("fetches every file across multiple batches and caches each exactly once", async () => {
    const many = {};

    for (let i = 0; i < 120; i++) {
      many[`Note${i}.md`] = { type: "file", size: 100 };
    }

    const cache = makeCache();
    const result = prefetchVaultContent("v", many, cache);
    await result.bulk;

    // 120 files / 50 per batch = 3 batches; each path is fetched once and cached.
    expect(fetchCalls.length).toBe(3);

    const allPaths = fetchCalls.flat();
    expect(allPaths.length).toBe(120);
    expect(new Set(allPaths).size).toBe(120);
    expect(cache.store.size).toBe(120);
  });

  it("caches the batches that landed before a mid-stream failure, without rejecting", async () => {
    const many = {};

    for (let i = 0; i < 120; i++) {
      many[`Note${i}.md`] = { type: "file", size: 100 };
    }

    let calls = 0;
    globalThis.fetch = vi.fn(async (url, init) => {
      calls++;

      if (calls === 2) {
        return { ok: false, status: 500 };
      }

      const paths = JSON.parse(init.body).paths;
      const files = {};

      for (const p of paths) {
        files[p] = "content:" + p;
      }

      return { ok: true, json: async () => ({ files }) };
    });

    const cache = makeCache();
    const result = prefetchVaultContent("v", many, cache);

    await expect(result.bulk).resolves.toBeUndefined();
    // The batches that landed before the failing one are cached; the failure abandons the rest.
    expect(cache.store.size).toBeGreaterThan(0);
    expect(cache.store.size).toBeLessThan(120);
  });
});

describe("prefetchVaultContent plugin folder handling", () => {
  it("does not prefetch plugin-internal asset files in either slice, but keeps data.json", async () => {
    const t = {
      ".obsidian/plugins/iconize/main.js": { type: "file", size: 100 },
      ".obsidian/plugins/iconize/icons/pack/a.svg": { type: "file", size: 200 },
      ".obsidian/plugins/iconize/icons/pack/b.svg": { type: "file", size: 200 },
      ".obsidian/plugins/iconize/data.json": { type: "file", size: 50 },
      "Note.md": { type: "file", size: 100 },
    };

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    const all = fetchCalls.flat();
    expect(all).not.toContain(".obsidian/plugins/iconize/icons/pack/a.svg");
    expect(all).not.toContain(".obsidian/plugins/iconize/icons/pack/b.svg");
    expect(all).toContain(".obsidian/plugins/iconize/data.json");
    expect(all).toContain("Note.md");
  });

  it("does not prefetch a plugin's bundled markdown", async () => {
    const t = {
      ".obsidian/plugins/p/templates/T.md": { type: "file", size: 100 },
      "Real.md": { type: "file", size: 100 },
    };

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    const all = fetchCalls.flat();
    expect(all).not.toContain(".obsidian/plugins/p/templates/T.md");
    expect(all).toContain("Real.md");
  });

  it("excludes a nested data.json, admitting only a plugin's top-level data.json", async () => {
    const t = {
      ".obsidian/plugins/foo/data.json": { type: "file", size: 50 },
      ".obsidian/plugins/foo/sub/data.json": { type: "file", size: 50 },
      "Note.md": { type: "file", size: 100 },
    };

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    const all = fetchCalls.flat();
    expect(all).toContain(".obsidian/plugins/foo/data.json");
    expect(all).not.toContain(".obsidian/plugins/foo/sub/data.json");
  });

  it("prefetches snippets and themes in the bulk slice", async () => {
    const t = {
      ".obsidian/app.json": { type: "file", size: 100 },
      ".obsidian/snippets/custom.css": { type: "file", size: 100 },
      ".obsidian/themes/MyTheme/theme.css": { type: "file", size: 100 },
    };

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    const bulk = fetchCalls[1] || [];
    expect(bulk).toContain(".obsidian/snippets/custom.css");
    expect(bulk).toContain(".obsidian/themes/MyTheme/theme.css");
  });
});

describe("prefetchVaultContent file and byte caps", () => {
  it("caps the number of files prefetched at MAX_FILES and warns once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = {};

    for (let i = 0; i < 5000; i++) {
      t["notes/n" + i + ".md"] = { type: "file", size: 10 };
    }

    const result = prefetchVaultContent("v", t, makeCache());
    await result.bulk;

    expect(fetchCalls.flat().length).toBe(4000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("4000-file cap"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("1000 file(s)"),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("shrinks the byte budget when the content cache is small", async () => {
    const t = {};

    // 40 notes of 0.4 MB each (under the 512 KB per-file cap) is 16 MB of candidates.
    for (let i = 0; i < 40; i++) {
      t["n" + i + ".md"] = { type: "file", size: 400 * 1024 };
    }

    // A 16 MB cache yields a 0.75 * 16 = 12 MB budget; 30 of the 40 notes (30 * 400 KB) fit, the 31st would exceed it.
    const cache = { ...makeCache(), maxSize: 16 * MB };
    const result = prefetchVaultContent("v", t, cache);
    await result.bulk;

    expect(fetchCalls.flat().length).toBe(30);
  });

  it("clamps the total budget to the cache size so the prefetch never exceeds it", async () => {
    const t = {};

    // 20 notes of 0.4 MB each is 8 MB of candidates; a 4 MB cache must hold the prefetch within 4 MB.
    for (let i = 0; i < 20; i++) {
      t["n" + i + ".md"] = { type: "file", size: 400 * 1024 };
    }

    // A 4 MB cache: the budget clamps to 4 MB even though the 8 MB floor is higher, so the prefetch cannot self-evict.
    const cache = { ...makeCache(), maxSize: 4 * MB };
    const result = prefetchVaultContent("v", t, cache);
    await result.bulk;

    expect(fetchCalls.flat().length).toBe(10);
    expect(fetchCalls.flat().length * 400 * 1024).toBeLessThanOrEqual(4 * MB);
  });

  it("lets priority claim the whole budget ahead of bulk, leaving a note for on-demand", async () => {
    const t = {
      ".obsidian/plugins/a/main.js": { type: "file", size: 3 * MB },
      ".obsidian/plugins/b/main.js": { type: "file", size: 3 * MB },
      ".obsidian/plugins/c/main.js": { type: "file", size: 3 * MB },
      "Note.md": { type: "file", size: 100 },
    };

    // A 12 MB cache yields a 9 MB budget; the three 3 MB bundles claim all of it, so the note is left for on-demand.
    const cache = { ...makeCache(), maxSize: 12 * MB };
    const result = prefetchVaultContent("v", t, cache);

    await expect(result.bulk).resolves.toBeUndefined();
    const all = fetchCalls.flat();
    expect(all).toContain(".obsidian/plugins/a/main.js");
    expect(all).not.toContain("Note.md");
  });
});
