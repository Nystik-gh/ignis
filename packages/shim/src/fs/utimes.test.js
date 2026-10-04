import { describe, it, expect, vi, afterEach } from "vitest";
import { createUtimes } from "./utimes.js";
import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";
import {
  bufferWrite,
  enqueue,
  enqueueWrite,
  hasPending,
  initWriteCoalescer,
  _reset as resetCoalescer,
} from "./write-coalescer.js";
import {
  getDetail,
  initWriteDurability,
  hasWriteInProgress,
  listPending,
  _reset as resetDurability,
} from "./write-durability.js";
import { isRecentSentOp } from "./echo-guard.js";
import { createFsSync } from "./sync.js";
import { createFsPromises } from "./promises.js";
import { createFsCallbacks } from "./callback.js";
import { createFdOps } from "./fd.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function makeDeps(paths = []) {
  const metadataCache = new MetadataCache();

  for (const p of paths) {
    metadataCache.set(p, { type: "file", size: 1, mtime: 1, ctime: 1 });
  }

  const transport = {
    utimes: vi.fn(async (p, atime, mtime) => ({
      type: "file",
      size: 1,
      mtime,
      ctime: 1,
    })),
    writeFile: vi.fn(async () => ({ mtime: 5, size: 1 })),
  };

  initWriteCoalescer(transport);
  initWriteDurability(transport, enqueue);

  return {
    metadataCache,
    transport,
    commit: createUtimes(metadataCache, transport),
  };
}

function thrownBy(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }

  return null;
}

afterEach(() => {
  resetCoalescer();
  resetDurability();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("utimes times", () => {
  it.each([
    NaN,
    null,
    undefined,
    Infinity,
    "abc",
    "Infinity",
    10n,
    {},
    new Date(NaN),
  ])("refuses %s as Node does", (time) => {
    const d = makeDeps(["refused.md"]);
    const error = thrownBy(() => d.commit("refused.md", time, time));

    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(d.transport.utimes).not.toHaveBeenCalled();
  });

  it("takes seconds, numeric strings, and Dates", async () => {
    const d = makeDeps(["n.md", "s.md", "d.md"]);

    d.commit("n.md", 5, 6);
    d.commit("s.md", "7", "8");
    d.commit("d.md", new Date(1000), new Date(2000));
    await settle();

    expect(d.transport.utimes).toHaveBeenCalledWith("n.md", 5000, 6000);
    expect(d.transport.utimes).toHaveBeenCalledWith("s.md", 7000, 8000);
    expect(d.transport.utimes).toHaveBeenCalledWith("d.md", 1000, 2000);
  });

  it("reads a negative number as now", async () => {
    const d = makeDeps(["negative.md"]);

    vi.spyOn(Date, "now").mockReturnValue(4242);
    d.commit("negative.md", -1, -1);
    await settle();

    expect(d.transport.utimes).toHaveBeenCalledWith("negative.md", 4242, 4242);
  });

  it("refuses a path the cache does not hold with ENOENT", () => {
    const d = makeDeps();

    expect(thrownBy(() => d.commit("ghost.md", 1, 1)).code).toBe("ENOENT");
    expect(d.transport.utimes).not.toHaveBeenCalled();
  });
});

describe("utimes ordering", () => {
  it("waits for an in-flight write to the same path", async () => {
    const d = makeDeps(["queued.md"]);
    const write = deferred();

    enqueue("queued.md", () => write.promise);
    d.commit("queued.md", 1, 2);
    await settle();

    expect(d.transport.utimes).not.toHaveBeenCalled();

    write.resolve();
    await settle();

    expect(d.transport.utimes).toHaveBeenCalledWith("queued.md", 1000, 2000);
  });

  it("flushes a buffered boot write and lands after it", async () => {
    const d = makeDeps(["boot.md"]);

    bufferWrite("boot.md", "data", "utf-8", null);
    await d.commit("boot.md", 1, 2);

    expect(d.transport.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      d.transport.utimes.mock.invocationCallOrder[0],
    );
  });

  it("waits for a write in retry backoff and goes out after it lands", async () => {
    vi.useFakeTimers();

    const d = makeDeps(["retry.md"]);

    d.transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    enqueueWrite("retry.md", "data", "utf-8", null).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await d.commit("retry.md", 1, 2);

    expect(d.transport.utimes).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(d.transport.writeFile).toHaveBeenCalledTimes(2);
    expect(d.transport.utimes).toHaveBeenCalledWith("retry.md", 1000, 2000);
    expect(d.transport.writeFile.mock.invocationCallOrder[1]).toBeLessThan(
      d.transport.utimes.mock.invocationCallOrder[0],
    );
  });

  it("drops a touch waiting on a retry once a newer write lands", async () => {
    vi.useFakeTimers();

    const d = makeDeps(["superseded.md"]);

    d.transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    enqueueWrite("superseded.md", "old", "utf-8", null).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await d.commit("superseded.md", 1, 2);
    await enqueueWrite("superseded.md", "new", "utf-8", null);
    await vi.advanceTimersByTimeAsync(60000);

    expect(d.transport.utimes).not.toHaveBeenCalled();
  });

  it("lands after a sync write to the same path", async () => {
    const d = makeDeps(["sync.md"]);
    const write = deferred();
    const fs = createFsSync(d.metadataCache, new ContentCache(), d.transport);

    d.transport.writeFile.mockImplementationOnce(() => write.promise);
    fs.writeFileSync("sync.md", "data");
    fs.utimesSync("sync.md", 1, 2);
    await settle();

    expect(d.transport.utimes).not.toHaveBeenCalled();

    write.resolve({ mtime: 5, size: 4 });
    await settle();

    expect(d.transport.utimes).toHaveBeenCalledWith("sync.md", 1000, 2000);
  });
});

describe("writeFileSync send", () => {
  it("retries a failed send silently", async () => {
    vi.useFakeTimers();

    const d = makeDeps(["silent.md"]);
    const fs = createFsSync(d.metadataCache, new ContentCache(), d.transport);

    d.transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    fs.writeFileSync("silent.md", "data");
    await vi.advanceTimersByTimeAsync(0);

    expect(hasWriteInProgress("silent.md")).toBe(true);
    expect(listPending()).toEqual([]);
    expect(getDetail()).toEqual({ pending: 0, retrying: 0 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(d.transport.writeFile).toHaveBeenCalledTimes(2);
    expect(hasWriteInProgress("silent.md")).toBe(false);
  });

  it("cancels a buffered write to the same path", async () => {
    vi.useFakeTimers();

    const d = makeDeps(["buffered.md"]);
    const fs = createFsSync(d.metadataCache, new ContentCache(), d.transport);

    bufferWrite("buffered.md", "old", "utf-8", null);
    fs.writeFileSync("buffered.md", "new");

    expect(hasPending("buffered.md")).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);

    expect(d.transport.writeFile.mock.calls.map((call) => call[1])).toEqual([
      "new",
    ]);
  });
});

describe("utimes reply", () => {
  it("keeps the times the server reports", async () => {
    const d = makeDeps(["reply.md"]);

    d.transport.utimes.mockResolvedValueOnce({
      type: "file",
      size: 9,
      mtime: 1999.999,
      ctime: 1000,
    });
    await d.commit("reply.md", 1, 2);

    expect(d.metadataCache.get("reply.md")).toMatchObject({
      size: 9,
      mtime: 1999.999,
      ctime: 1000,
    });
  });

  it("marks the touch as this tab's own op", async () => {
    const d = makeDeps(["echo.md"]);

    await d.commit("echo.md", 1, 2);

    expect(isRecentSentOp("echo.md")).toBe(true);
  });
});

describe("utimes variants", () => {
  function openFd(d, path) {
    const contentCache = new ContentCache();

    contentCache.set(path, "x");

    const fdOps = createFdOps(d.metadataCache, contentCache, d.transport);

    return { fdOps, fd: fdOps.openSync(path, "r") };
  }

  it("touches an open fd's file", async () => {
    const d = makeDeps(["fd.md"]);
    const { fdOps, fd } = openFd(d, "fd.md");

    fdOps.futimesSync(fd, 1, 2);
    await settle();

    expect(d.transport.utimes).toHaveBeenCalledWith("fd.md", 1000, 2000);
  });

  it("calls back from futimes once the touch lands", async () => {
    const d = makeDeps(["fd-callback.md"]);
    const { fdOps, fd } = openFd(d, "fd-callback.md");
    const cb = vi.fn();

    fdOps.futimes(fd, 3, 4, cb);

    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(null));
    expect(d.transport.utimes).toHaveBeenCalledWith(
      "fd-callback.md",
      3000,
      4000,
    );
  });

  it("touches a FileHandle's file", async () => {
    const d = makeDeps(["handle.md"]);
    const contentCache = new ContentCache();

    contentCache.set("handle.md", "x");

    const fs = createFsPromises(d.metadataCache, contentCache, d.transport);
    const handle = await fs.open("handle.md", "r");

    await handle.utimes(5, 6);

    expect(d.transport.utimes).toHaveBeenCalledWith("handle.md", 5000, 6000);
  });

  it("treats lutimes as utimes", async () => {
    const d = makeDeps(["link.md"]);
    const fs = createFsPromises(
      d.metadataCache,
      new ContentCache(),
      d.transport,
    );

    await fs.lutimes("link.md", 7, 8);

    expect(d.transport.utimes).toHaveBeenCalledWith("link.md", 7000, 8000);
  });

  it("throws invalid times from the callback form", () => {
    const d = makeDeps(["callback.md"]);
    const callbacks = createFsCallbacks(
      createFsPromises(d.metadataCache, new ContentCache(), d.transport),
    );
    const cb = vi.fn();

    expect(() => callbacks.utimes("callback.md", NaN, NaN, cb)).toThrow(
      TypeError,
    );
    expect(cb).not.toHaveBeenCalled();
  });
});
