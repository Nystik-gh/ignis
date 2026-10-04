import { describe, it, expect, vi, afterEach } from "vitest";
import { createFsPromises } from "./promises.js";
import { registerPathResolver, resolvePath, _reset } from "./transforms.js";
import { isRecentSentOp } from "./echo-guard.js";
import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";

function makeDeps() {
  const store = new Map();

  const metadataCache = {
    has: (p) => store.has(p),
    get: (p) => (store.has(p) ? store.get(p) : null),
    set: (p, m) => store.set(p, m),
    delete: (p) => store.delete(p),
    toStat: (p) =>
      store.has(p)
        ? {
            type: store.get(p).type,
            isDirectory: () => store.get(p).type === "directory",
            isFile: () => store.get(p).type === "file",
          }
        : null,
    readdir: () => [],
  };

  const contentCache = {
    get: () => null,
    pathUpdates: () => 0,
    set: vi.fn(),
    setFromServer: vi.fn(),
    delete: vi.fn(),
    invalidate: vi.fn(),
  };

  const transport = {
    mkdir: vi.fn(async () => {}),
    rmdir: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ type: "file", size: 1 })),
    readFile: vi.fn(async () => {
      throw new Error("transport.readFile should not be called");
    }),
  };

  return { metadataCache, contentCache, transport, store };
}

describe("promises directory mutations honor path resolvers", () => {
  afterEach(() => _reset());

  it("mkdir uses the resolved path for cache, echo-guard, and transport", async () => {
    registerPathResolver(
      (p) => p === "logical/dir",
      () => "physical/dir",
    );

    const deps = makeDeps();
    const fs = createFsPromises(
      deps.metadataCache,
      deps.contentCache,
      deps.transport,
    );

    await fs.mkdir("logical/dir", { recursive: true });

    expect(deps.store.get("physical/dir")).toEqual({ type: "directory" });
    expect(deps.store.has("logical/dir")).toBe(false);
    expect(deps.transport.mkdir).toHaveBeenCalledWith("physical/dir", true);
    expect(isRecentSentOp("physical/dir")).toBe(true);
    expect(isRecentSentOp("logical/dir")).toBe(false);
  });

  it("rmdir uses the resolved path for cache, echo-guard, and transport", async () => {
    registerPathResolver(
      (p) => p === "logical/dir",
      () => "physical/dir",
    );

    const deps = makeDeps();
    const fs = createFsPromises(
      deps.metadataCache,
      deps.contentCache,
      deps.transport,
    );
    deps.store.set("physical/dir", { type: "directory" });

    await fs.rmdir("logical/dir");

    expect(deps.store.has("physical/dir")).toBe(false);
    expect(deps.transport.rmdir).toHaveBeenCalledWith("physical/dir");
    expect(isRecentSentOp("physical/dir")).toBe(true);
  });
});

describe("promises rename", () => {
  it("drops the content the destination held", async () => {
    const metadataCache = new MetadataCache();
    const contentCache = new ContentCache();
    const transport = { rename: vi.fn(async () => {}) };
    const fs = createFsPromises(metadataCache, contentCache, transport);
    const from = resolvePath("src.md");
    const to = resolvePath("dst.md");

    metadataCache.set(from, { type: "file", size: 3 });
    metadataCache.set(to, { type: "file", size: 5 });
    contentCache.set(to, "stale");

    await fs.rename("src.md", "dst.md");

    expect(contentCache.get(to)).toBeNull();
    expect(metadataCache.get(to)).toEqual({ type: "file", size: 3 });
  });

  it("carries the source's own content to the destination", async () => {
    const metadataCache = new MetadataCache();
    const contentCache = new ContentCache();
    const transport = { rename: vi.fn(async () => {}) };
    const fs = createFsPromises(metadataCache, contentCache, transport);
    const from = resolvePath("src.md");
    const to = resolvePath("dst.md");

    metadataCache.set(from, { type: "file", size: 5 });
    metadataCache.set(to, { type: "file", size: 5 });
    contentCache.set(from, "fresh");
    contentCache.set(to, "stale");

    await fs.rename("src.md", "dst.md");

    expect(contentCache.get(to)).toBe("fresh");
    expect(contentCache.get(from)).toBeNull();
  });
});

describe("promises readFile existence", () => {
  afterEach(() => _reset());

  it("answers ENOENT from the cache for a missing non-redirected path, no transport", async () => {
    const deps = makeDeps();
    const fs = createFsPromises(
      deps.metadataCache,
      deps.contentCache,
      deps.transport,
    );

    await expect(
      fs.readFile("/.obsidian/backlink.json", "utf8"),
    ).rejects.toThrow(/ENOENT/);
    expect(deps.transport.readFile).not.toHaveBeenCalled();
  });

  it("falls back to the original path for a redirected miss", async () => {
    registerPathResolver(
      (p) => p === ".obsidian/workspace.json",
      () => ".obsidian/workspace.Work.json",
    );

    const deps = makeDeps();
    deps.transport.readFile = vi.fn(async (p) => {
      if (p === ".obsidian/workspace.Work.json") {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }

      return "BASE";
    });

    const fs = createFsPromises(
      deps.metadataCache,
      deps.contentCache,
      deps.transport,
    );

    // Returns the base content after the redirect target 404s: the fallback fired.
    await expect(
      fs.readFile("/.obsidian/workspace.json", "utf8"),
    ).resolves.toBe("BASE");
    expect(deps.transport.readFile).toHaveBeenCalledWith(
      ".obsidian/workspace.Work.json",
      "utf8",
    );
  });
});

describe("promises readFile racing a write", () => {
  it("keeps content written while the read was in flight", async () => {
    const metadataCache = new MetadataCache();
    const contentCache = new ContentCache();
    let release;

    metadataCache.set("note.md", { type: "file", size: 6, mtime: 1 });

    const transport = {
      readFile: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve("server");
          }),
      ),
      writeFile: vi.fn(async () => ({ mtime: 2, size: 5 })),
    };

    const fs = createFsPromises(metadataCache, contentCache, transport);
    const read = fs.readFile("note.md", "utf8");

    await fs.writeFile("note.md", "local", "utf8");
    release();
    await read;

    expect(await fs.readFile("note.md", "utf8")).toBe("local");
    expect(transport.readFile).toHaveBeenCalledTimes(1);
  });
});
