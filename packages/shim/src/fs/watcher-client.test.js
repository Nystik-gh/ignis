import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWatcherClient } from "./watcher-client.js";
import { markSentOp } from "./echo-guard.js";
import { MetadataCache } from "./metadata-cache.js";
import { bufferWrite, cancelPending } from "./write-coalescer.js";
import { trackWrite, _reset as resetDurability } from "./write-durability.js";

const RESYNC_DEBOUNCE_MS = 1000;

function makeDeps(metadataOverride) {
  const store = new Map();

  const metadataCache = metadataOverride || {
    get: (p) => store.get(p) || null,
    set: (p, m) => store.set(p, m),
    delete: (p) => store.delete(p),
    has: (p) => store.has(p),
    keys: () => [...store.keys()],
    deleteSubtree: (p) => {
      const removed = [...store.keys()].filter(
        (k) => k === p || k.startsWith(p + "/"),
      );

      for (const k of removed) {
        store.delete(k);
      }

      return removed;
    },
  };

  const contentCache = {
    invalidate: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    get: () => null,
  };

  const fsWatch = { _dispatch: vi.fn() };
  const metadataChannel = { subscribe: vi.fn(), send: vi.fn() };
  const wsClient = {
    subscribe: vi.fn(),
    onOpen: vi.fn(),
    channel: vi.fn(() => metadataChannel),
  };
  const transport = { fetchTree: vi.fn() };

  const client = createWatcherClient(
    metadataCache,
    contentCache,
    fsWatch,
    wsClient,
    transport,
  );

  return {
    store,
    metadataCache,
    contentCache,
    fsWatch,
    metadataChannel,
    wsClient,
    transport,
    client,
  };
}

async function resyncWith(d, tree) {
  d.transport.fetchTree.mockResolvedValue({ tree, etag: '"t"' });
  d.wsClient.onOpen.mock.calls[0][0]();

  await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);
}

describe("watcher-client reconcile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a file present in the tree but missing from the cache", async () => {
    const d = makeDeps();

    await resyncWith(d, {
      "new.md": { type: "file", size: 5, mtime: 100, ctime: 50 },
    });

    expect(d.store.get("new.md")).toMatchObject({ type: "file", size: 5 });
    expect(d.contentCache.invalidate).toHaveBeenCalledWith("new.md");
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("created", "new.md");
  });

  it("adds a directory as a folder", async () => {
    const d = makeDeps();

    await resyncWith(d, { newdir: { type: "directory" } });

    expect(d.store.get("newdir")).toEqual({ type: "directory" });
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith(
      "folder-created",
      "newdir",
    );
  });

  it("modifies a file whose mtime or size changed", async () => {
    const d = makeDeps();
    d.store.set("a.md", { type: "file", size: 1, mtime: 10 });

    await resyncWith(d, {
      "a.md": { type: "file", size: 2, mtime: 20, ctime: 5 },
    });

    expect(d.store.get("a.md")).toMatchObject({ size: 2, mtime: 20 });
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("modified", "a.md");
  });

  it("is a no-op for an unchanged file", async () => {
    const d = makeDeps();
    d.store.set("a.md", { type: "file", size: 1, mtime: 10 });

    await resyncWith(d, {
      "a.md": { type: "file", size: 1, mtime: 10, ctime: 5 },
    });

    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });

  it("deletes a cache entry absent from the tree and preserves the root", async () => {
    const d = makeDeps();
    d.store.set("", { type: "directory" });
    d.store.set("gone.md", { type: "file", size: 1, mtime: 10 });
    d.store.set("keep.md", { type: "file", size: 1, mtime: 10 });

    await resyncWith(d, {
      "keep.md": { type: "file", size: 1, mtime: 10, ctime: 5 },
    });

    expect(d.store.has("gone.md")).toBe(false);
    expect(d.store.has("")).toBe(true);
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("deleted", "gone.md");
    expect(d.fsWatch._dispatch).not.toHaveBeenCalledWith("deleted", "keep.md");
  });

  it("sweeps a stale directory and its descendants once each", async () => {
    const d = makeDeps();
    d.store.set("gone", { type: "directory" });
    d.store.set("gone/one.md", { type: "file", size: 1, mtime: 10 });
    d.store.set("gone/sub", { type: "directory" });
    d.store.set("gone/sub/two.md", { type: "file", size: 1, mtime: 10 });
    d.store.set("keep.md", { type: "file", size: 1, mtime: 10 });

    await resyncWith(d, {
      "keep.md": { type: "file", size: 1, mtime: 10, ctime: 5 },
    });

    expect([...d.store.keys()]).toEqual(["keep.md"]);

    const deletes = d.fsWatch._dispatch.mock.calls.filter(
      (c) => c[0] === "deleted",
    );

    expect(deletes.map((c) => c[1]).sort()).toEqual([
      "gone",
      "gone/one.md",
      "gone/sub",
      "gone/sub/two.md",
    ]);
  });

  it("skips a path with a recent local op", async () => {
    const d = makeDeps();
    const p = "recent-local-op-reconcile.md";
    markSentOp(p);

    await resyncWith(d, {
      [p]: { type: "file", size: 5, mtime: 100, ctime: 50 },
    });

    expect(d.store.has(p)).toBe(false);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });
});

describe("watcher-client resync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const scheduleResyncOf = (d) => d.wsClient.onOpen.mock.calls[0][0];

  it("skips reconcile when the server reports the tree is not modified", async () => {
    const d = makeDeps();
    d.transport.fetchTree.mockResolvedValue({ notModified: true, etag: '"1"' });

    scheduleResyncOf(d)();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenCalledWith(null);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });

  it("reconciles the tree and sends the stored revision on the next resync", async () => {
    const d = makeDeps();
    d.transport.fetchTree
      .mockResolvedValueOnce({
        tree: { "fresh.md": { type: "file", size: 3, mtime: 1, ctime: 1 } },
        etag: '"2"',
      })
      .mockResolvedValueOnce({ notModified: true, etag: '"2"' });

    const scheduleResync = scheduleResyncOf(d);

    scheduleResync();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.store.get("fresh.md")).toMatchObject({ type: "file", size: 3 });
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("created", "fresh.md");

    scheduleResync();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenLastCalledWith('"2"');
  });
});

describe("watcher-client revision channel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const handlerOf = (d, type) =>
    d.metadataChannel.subscribe.mock.calls.find((c) => c[0] === type)[1];

  function atRevision(rev) {
    const d = makeDeps();

    d.transport.fetchTree.mockResolvedValue({ notModified: true, etag: rev });
    d.client.setTreeEtag(rev);

    return d;
  }

  it("subscribes to the metadata channel for both announcements", () => {
    const d = makeDeps();

    const types = d.metadataChannel.subscribe.mock.calls.map((c) => c[0]);

    expect(d.wsClient.channel).toHaveBeenCalledWith("metadata");
    expect(types).toContain("revision");
    expect(types).toContain("replaced");
  });

  it("adopts an announced revision as the one it revalidates against", async () => {
    const d = atRevision('"a-1"');

    handlerOf(d, "revision")({ etag: '"a-2"' });
    d.wsClient.onOpen.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenCalledWith('"a-2"');
  });

  it("adopts an announced revision that sits below the one it holds", async () => {
    const d = atRevision('"a-9"');

    handlerOf(d, "revision")({ etag: '"a-4"' });
    d.wsClient.onOpen.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenCalledWith('"a-4"');
  });

  it("fetches nothing on an announcement", async () => {
    const d = atRevision('"a-1"');

    handlerOf(d, "revision")({ etag: '"a-2"' });
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).not.toHaveBeenCalled();
  });

  it("holds its revision when the announcement repeats it", async () => {
    const d = atRevision('"a-1"');

    handlerOf(d, "revision")({ etag: '"a-1"' });
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).not.toHaveBeenCalled();

    d.wsClient.onOpen.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenCalledWith('"a-1"');
  });

  it("resyncs at once on a replacement, even at the revision it holds", () => {
    const d = atRevision('"a-1"');

    handlerOf(d, "replaced")({ etag: '"a-1"' });

    expect(d.transport.fetchTree).toHaveBeenCalledWith('"a-1"');
  });

  it("folds a pending resync from a socket open into the replacement resync", async () => {
    const d = atRevision('"a-1"');

    d.wsClient.onOpen.mock.calls[0][0]();
    handlerOf(d, "replaced")({ etag: '"a-2"' });
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

    expect(d.transport.fetchTree).toHaveBeenCalledTimes(1);
    expect(d.transport.fetchTree).toHaveBeenCalledWith('"a-1"');
  });
});

describe("watcher-client resync delete guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const eventHandlerOf = (d, type) =>
    d.wsClient.subscribe.mock.calls.find((c) => c[0] === type)[1];

  function mockStalledResync(d, tree) {
    let unblock;
    const blocked = new Promise((r) => (unblock = r));

    d.transport.fetchTree.mockImplementation(() =>
      blocked.then(() => ({ tree, etag: '"t"' })),
    );

    return async (duringFetch) => {
      d.wsClient.onOpen.mock.calls[0][0]();
      await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

      duringFetch();
      unblock();

      await vi.advanceTimersByTimeAsync(0);
    };
  }

  it("keeps a file an event created while the fetch was open", async () => {
    const d = makeDeps();
    d.store.set("stale.md", { type: "file", size: 1, mtime: 1 });

    const resync = mockStalledResync(d, {
      "old.md": { type: "file", size: 1, mtime: 1, ctime: 1 },
    });

    await resync(() =>
      eventHandlerOf(
        d,
        "created",
      )({
        path: "racing.md",
        stat: { size: 4, mtime: 9, ctime: 9 },
      }),
    );

    expect(d.store.get("racing.md")).toMatchObject({ type: "file", size: 4 });
    expect(d.store.has("stale.md")).toBe(true);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalledWith(
      "deleted",
      "racing.md",
    );
  });

  it("keeps a directory an event created while the fetch was open", async () => {
    const d = makeDeps();

    const resync = mockStalledResync(d, {
      "old.md": { type: "file", size: 1, mtime: 1, ctime: 1 },
    });

    await resync(() =>
      eventHandlerOf(d, "folder-created")({ path: "racing-dir" }),
    );

    expect(d.store.get("racing-dir")).toEqual({ type: "directory" });
    expect(d.fsWatch._dispatch).not.toHaveBeenCalledWith(
      "deleted",
      "racing-dir",
    );
  });

  it("still applies the tree's own creates and modifies", async () => {
    const d = makeDeps();

    const resync = mockStalledResync(d, {
      "fresh.md": { type: "file", size: 3, mtime: 7, ctime: 7 },
    });

    await resync(() =>
      eventHandlerOf(
        d,
        "created",
      )({
        path: "racing.md",
        stat: { size: 4, mtime: 9, ctime: 9 },
      }),
    );

    expect(d.store.get("fresh.md")).toMatchObject({ type: "file", size: 3 });
  });

  it("sweeps a stale key when no event landed during the fetch", async () => {
    const d = makeDeps();
    d.store.set("gone.md", { type: "file", size: 1, mtime: 1 });

    const resync = mockStalledResync(d, {
      "keep.md": { type: "file", size: 1, mtime: 1, ctime: 1 },
    });

    await resync(() => {});

    expect(d.store.has("gone.md")).toBe(false);
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("deleted", "gone.md");
  });

  it("sweeps when the only event was a delete its directory already took", async () => {
    const cache = new MetadataCache();
    cache.set("d", { type: "directory" });
    cache.set("d/one.md", { type: "file", size: 1, mtime: 1 });
    cache.set("gone.md", { type: "file", size: 1, mtime: 1 });

    const d = makeDeps(cache);
    const onDeleted = eventHandlerOf(d, "deleted");

    onDeleted({ path: "d" });

    const resync = mockStalledResync(d, {
      "keep.md": { type: "file", size: 1, mtime: 1, ctime: 1 },
    });

    await resync(() => onDeleted({ path: "d/one.md" }));

    expect(cache.has("gone.md")).toBe(false);
  });

  it("skips the delete pass when the browser writes mid-resync", async () => {
    const d = makeDeps();
    const own = "writers-own-file.md";

    d.store.set("gone.md", { type: "file", size: 1, mtime: 1 });

    const resync = mockStalledResync(d, {
      "keep.md": { type: "file", size: 1, mtime: 1, ctime: 1 },
    });

    await resync(() => {
      markSentOp(own);
      d.store.set(own, { type: "file", size: 4, mtime: 9, ctime: 9 });
    });

    expect(d.store.has(own)).toBe(true);
    expect(d.store.has("gone.md")).toBe(true);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalledWith("deleted", own);
  });
});

describe("watcher-client directory deletes", () => {
  const seeded = () => {
    const cache = new MetadataCache();

    cache.set("d", { type: "directory" });
    cache.set("d/one.md", { type: "file", size: 1, mtime: 10 });
    cache.set("d/sub", { type: "directory" });
    cache.set("d/sub/two.md", { type: "file", size: 2, mtime: 10 });
    cache.set("keep.md", { type: "file", size: 3, mtime: 10 });

    return { cache, d: makeDeps(cache) };
  };

  const eventHandlerOf = (d, type) =>
    d.wsClient.subscribe.mock.calls.find((c) => c[0] === type)[1];

  it("takes the descendants of a deleted directory out of the cache", () => {
    const { cache, d } = seeded();

    eventHandlerOf(d, "deleted")({ path: "d" });

    expect(cache.keys()).toEqual(["keep.md"]);
    expect(cache.toStat("d/sub/two.md")).toBeNull();
  });

  it("reports every path a deleted directory took", () => {
    const { d } = seeded();

    eventHandlerOf(d, "deleted")({ path: "d" });

    const deleted = d.fsWatch._dispatch.mock.calls
      .filter((c) => c[0] === "deleted")
      .map((c) => c[1]);

    expect(deleted.sort()).toEqual(["d", "d/one.md", "d/sub", "d/sub/two.md"]);

    for (const p of deleted) {
      expect(d.contentCache.invalidate).toHaveBeenCalledWith(p);
    }
  });

  it("dispatches each path once when a late child delete follows the sweep", () => {
    const { cache, d } = seeded();
    const onDeleted = eventHandlerOf(d, "deleted");

    onDeleted({ path: "d" });
    onDeleted({ path: "d/one.md" });
    onDeleted({ path: "d/sub/two.md" });

    const deleted = d.fsWatch._dispatch.mock.calls
      .filter((c) => c[0] === "deleted")
      .map((c) => c[1]);

    expect(deleted.sort()).toEqual(["d", "d/one.md", "d/sub", "d/sub/two.md"]);
    expect(cache.keys()).toEqual(["keep.md"]);
  });

  it("leaves siblings alone when a file is deleted", () => {
    const { cache, d } = seeded();

    eventHandlerOf(d, "deleted")({ path: "d/one.md" });

    expect(cache.has("d/one.md")).toBe(false);
    expect(cache.has("d/sub/two.md")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });
});

describe("watcher-client repopulation after a stale-tree delete", () => {
  const LIVE = { type: "file", size: 12, mtime: 1000, ctime: 900 };
  const STALE_TREE = {
    "other.md": { type: "file", size: 1, mtime: 5, ctime: 5 },
  };
  const FRESH_TREE = {
    ...STALE_TREE,
    "live.md": { type: "file", size: 12, mtime: 1000, ctime: 900 },
  };

  function seeded() {
    const cache = new MetadataCache();

    cache.set("live.md", { ...LIVE });

    return { cache, d: makeDeps(cache) };
  }

  function handlerOf(d, type) {
    return d.wsClient.subscribe.mock.calls.find((c) => c[0] === type)[1];
  }

  function expectLive(cache) {
    const stat = cache.toStat("live.md");

    expect(cache.has("live.md")).toBe(true);
    expect(cache.get("live.md")).toMatchObject({ type: "file" });
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.size).toBe(12);
    expect(stat.mtimeMs).toBe(1000);
    expect(stat.birthtimeMs).toBe(900);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repopulates from the watcher event that follows the delete", async () => {
    const { cache, d } = seeded();

    await resyncWith(d, STALE_TREE);

    expect(cache.has("live.md")).toBe(false);
    expect(cache.toStat("live.md")).toBeNull();
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("deleted", "live.md");

    const onModified = handlerOf(d, "modified");

    onModified({
      path: "live.md",
      stat: { size: 12, mtime: 1000, ctime: 900 },
    });

    expectLive(cache);
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("modified", "live.md");
    expect(d.contentCache.invalidate).toHaveBeenCalledWith("live.md");
  });

  it("repopulates from a create event when the path is recreated on disk", async () => {
    const { cache, d } = seeded();

    await resyncWith(d, STALE_TREE);

    const onCreated = handlerOf(d, "created");

    onCreated({ path: "live.md", stat: { size: 12, mtime: 1000, ctime: 900 } });

    expectLive(cache);
  });

  describe("through a resync", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("repopulates once the server tree carries the path again", async () => {
      const { cache, d } = seeded();

      d.transport.fetchTree
        .mockResolvedValueOnce({ tree: STALE_TREE, etag: '"stale"' })
        .mockResolvedValueOnce({ tree: FRESH_TREE, etag: '"fresh"' });

      const scheduleResync = d.wsClient.onOpen.mock.calls[0][0];

      scheduleResync();
      await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

      expect(cache.has("live.md")).toBe(false);

      scheduleResync();
      await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

      expectLive(cache);
      expect(d.transport.fetchTree).toHaveBeenLastCalledWith('"stale"');
    });

    it("leaves the path deleted while the server repeats that tree revision", async () => {
      const { cache, d } = seeded();

      d.transport.fetchTree
        .mockResolvedValueOnce({ tree: STALE_TREE, etag: '"stale"' })
        .mockResolvedValueOnce({ notModified: true, etag: '"stale"' });

      const scheduleResync = d.wsClient.onOpen.mock.calls[0][0];

      scheduleResync();
      await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

      scheduleResync();
      await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);

      expect(cache.has("live.md")).toBe(false);
    });
  });
});

describe("watcher-client unconfirmed writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetDurability();
    vi.useRealTimers();
  });

  function seeded(entries) {
    const cache = new MetadataCache();

    for (const [path, meta] of Object.entries(entries)) {
      cache.set(path, meta);
    }

    return { cache, d: makeDeps(cache) };
  }

  function retrying(path) {
    trackWrite(path).failure("local", "utf-8", null);
  }

  it("leaves a file alone on a resync while its write retries", async () => {
    const { cache, d } = seeded({
      "note.md": { type: "file", size: 5, mtime: 100 },
    });

    retrying("note.md");
    await resyncWith(d, { "note.md": { type: "file", size: 9, mtime: 999 } });

    expect(cache.get("note.md").mtime).toBe(100);
    expect(d.contentCache.invalidate).not.toHaveBeenCalledWith("note.md");
    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });

  it("keeps a file the server has not seen yet on a resync", async () => {
    const { cache, d } = seeded({
      "new.md": { type: "file", size: 5, mtime: 100 },
    });

    retrying("new.md");
    await resyncWith(d, {});

    expect(cache.has("new.md")).toBe(true);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });

  it("keeps a new file and its dirs when a resync drops their dir", async () => {
    const { cache, d } = seeded({
      dir: { type: "directory" },
      "dir/sub": { type: "directory" },
      "dir/sub/new.md": { type: "file", size: 5, mtime: 100 },
      "dir/old.md": { type: "file", size: 5, mtime: 100 },
    });

    retrying("dir/sub/new.md");
    await resyncWith(d, {});

    expect(cache.has("dir")).toBe(true);
    expect(cache.has("dir/sub")).toBe(true);
    expect(cache.has("dir/sub/new.md")).toBe(true);
    expect(cache.has("dir/old.md")).toBe(false);
    expect(d.fsWatch._dispatch.mock.calls).toEqual([["deleted", "dir/old.md"]]);
  });

  it("skips a live change to a file with a buffered boot write", () => {
    const { cache, d } = seeded({
      "note.md": { type: "file", size: 5, mtime: 100 },
    });
    const onModified = d.wsClient.subscribe.mock.calls.find(
      (c) => c[0] === "modified",
    )[1];

    bufferWrite("note.md", "local", "utf-8", null);
    onModified({ path: "note.md", stat: { size: 9, mtime: 999, ctime: 1 } });
    cancelPending("note.md");

    expect(cache.get("note.md").mtime).toBe(100);
    expect(d.fsWatch._dispatch).not.toHaveBeenCalled();
  });

  it("applies a resync to the file once its write is confirmed", async () => {
    const { cache, d } = seeded({
      "note.md": { type: "file", size: 5, mtime: 100 },
    });

    trackWrite("note.md").success();
    await resyncWith(d, { "note.md": { type: "file", size: 9, mtime: 999 } });

    expect(cache.get("note.md").mtime).toBe(999);
    expect(d.fsWatch._dispatch).toHaveBeenCalledWith("modified", "note.md");
  });
});
