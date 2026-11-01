import { describe, it, expect, vi, afterEach } from "vitest";
import { createFsSync } from "./sync.js";
import { createFsPromises } from "./promises.js";
import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";
import {
  enqueue,
  hasUnconfirmedWrite,
  initWriteCoalescer,
  _reset as resetCoalescer,
} from "./write-coalescer.js";
import {
  getState,
  hasFailedWrite,
  initWriteDurability,
  listPending,
  _reset as resetDurability,
} from "./write-durability.js";

describe("appendFileSync", () => {
  const nextTask = () => new Promise((r) => setTimeout(r, 0));

  function deferred() {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });

    return { promise, resolve };
  }

  function makeAppendFs() {
    const calls = [];
    const transport = {
      calls,
      writeFile: vi.fn(async (path, data) => {
        calls.push(`writeFile ${path} ${data}`);

        return { mtime: 5, size: 1 };
      }),
      appendFile: vi.fn(async (path, data) => {
        calls.push(`appendFile ${path} ${data}`);
      }),
      rename: vi.fn(async (from, to) => {
        calls.push(`rename ${from} ${to}`);
      }),
      stat: vi.fn(async () => ({ type: "file", size: 9, mtime: 7 })),
      readFileSync: vi.fn(() => {
        throw new Error("transport.readFileSync should not be called");
      }),
    };
    const metadataCache = new MetadataCache();
    const contentCache = new ContentCache();

    contentCache.retainWhile(
      (path) => hasUnconfirmedWrite(path) || hasFailedWrite(path),
    );
    contentCache.refuseFillWhile(hasUnconfirmedWrite);
    initWriteCoalescer(transport);
    initWriteDurability(transport, enqueue);

    return {
      fs: createFsSync(metadataCache, contentCache, transport),
      fsp: createFsPromises(metadataCache, contentCache, transport),
      transport,
      metadataCache,
      contentCache,
    };
  }

  afterEach(() => {
    resetCoalescer();
    resetDurability();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a read right after writeFileSync and appendFileSync returns both", () => {
    const { fs, transport } = makeAppendFs();

    fs.writeFileSync("log.md", "first");
    fs.appendFileSync("log.md", " second");

    expect(fs.readFileSync("log.md", "utf8")).toBe("first second");
    expect(transport.readFileSync).not.toHaveBeenCalled();
  });

  it("appending to a missing file creates it in the caches", () => {
    const { fs, metadataCache } = makeAppendFs();

    fs.appendFileSync("new.md", "line");

    expect(fs.existsSync("new.md")).toBe(true);
    expect(fs.readFileSync("new.md", "utf8")).toBe("line");
    expect(metadataCache.get("new.md")).toMatchObject({
      type: "file",
      size: 4,
    });
  });

  it("appends to cached bytes", () => {
    const { fs, contentCache } = makeAppendFs();

    fs.writeFileSync("data.bin", new Uint8Array([104, 105]));
    fs.appendFileSync("data.bin", "!");

    expect(contentCache.get("data.bin")).toEqual(
      new Uint8Array([104, 105, 33]),
    );
  });

  it("takes the server's metadata after the append", async () => {
    const { fs, transport, metadataCache } = makeAppendFs();

    metadataCache.set("log.md", { type: "file", size: 1, mtime: 1 });
    fs.appendFileSync("log.md", "more");
    await nextTask();

    expect(transport.appendFile).toHaveBeenCalledWith("log.md", "more");
    expect(metadataCache.get("log.md")).toEqual({
      type: "file",
      size: 9,
      mtime: 7,
    });
  });

  it("a failed stat after the append keeps the appended content", async () => {
    const { fs, transport, contentCache } = makeAppendFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync("log.md", "old");
    transport.stat.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("log.md", "more");
    await nextTask();
    await nextTask();

    expect(contentCache.get("log.md")).toBe("oldmore");
  });

  it("a failed append is retried as a write of the appended content", async () => {
    vi.useFakeTimers();

    const { fs, transport, metadataCache, contentCache } = makeAppendFs();

    metadataCache.set("log.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("log.md", "old");
    transport.appendFile.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("log.md", "more");
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.calls).toEqual(["writeFile log.md oldmore"]);
    expect(contentCache.get("log.md")).toBe("oldmore");
    expect(metadataCache.get("log.md")).toMatchObject({ mtime: 5 });
  });

  it("a second append sends the write of a failed first append before its own", async () => {
    vi.useFakeTimers();

    const { fs, transport, metadataCache, contentCache } = makeAppendFs();

    metadataCache.set("log.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("log.md", "old");
    transport.appendFile.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("log.md", "A");
    fs.appendFileSync("log.md", "B");
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.calls).toEqual([
      "writeFile log.md oldA",
      "appendFile log.md B",
    ]);
  });

  it("two failed appends are retried as one write of both", async () => {
    vi.useFakeTimers();

    const { fs, transport, metadataCache, contentCache } = makeAppendFs();

    metadataCache.set("log.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("log.md", "old");
    transport.appendFile.mockRejectedValue(new Error("offline"));
    transport.writeFile.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("log.md", "A");
    fs.appendFileSync("log.md", "B");
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.calls.at(-1)).toBe("writeFile log.md oldAB");
    expect(contentCache.get("log.md")).toBe("oldAB");
  });

  it("a failed append to a missing file is retried as a write", async () => {
    vi.useFakeTimers();

    const { fs, transport } = makeAppendFs();

    transport.appendFile.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("new.md", "line");
    await vi.advanceTimersByTimeAsync(1100);

    expect(fs.existsSync("new.md")).toBe(true);
    expect(transport.calls.at(-1)).toBe("writeFile new.md line");
  });

  it("a rename after a failed append sends the appended content before the rename", async () => {
    const { fs, transport, metadataCache, contentCache } = makeAppendFs();

    metadataCache.set("a.md", { type: "file", size: 1, mtime: 1 });
    contentCache.set("a.md", "C");
    transport.appendFile.mockRejectedValueOnce(new Error("EACCES"));

    fs.appendFileSync("a.md", "d");
    fs.renameSync("a.md", "b.md");
    await nextTask();
    await nextTask();

    expect(transport.calls).toEqual(["writeFile a.md Cd", "rename a.md b.md"]);
    expect(fs.readFileSync("b.md", "utf8")).toBe("Cd");
  });

  it("a failed append after a failed write is retried as one write of both", async () => {
    vi.useFakeTimers();

    const { fs, transport, metadataCache, contentCache } = makeAppendFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("a.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("a.md", "old");
    transport.writeFile
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"));
    transport.appendFile.mockRejectedValueOnce(new Error("503"));

    fs.writeFileSync("a.md", "XX");
    await vi.advanceTimersByTimeAsync(0);
    fs.appendFileSync("a.md", "d");
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.calls.at(-1)).toBe("writeFile a.md XXd");
    expect(contentCache.get("a.md")).toBe("XXd");
    expect(metadataCache.get("a.md")).toMatchObject({ mtime: 5 });
  });

  it("a failed append to a file whose content is not cached leaves the caches", async () => {
    const { fs, transport, metadataCache, contentCache } = makeAppendFs();
    const meta = { type: "file", size: 3, mtime: 1 };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    metadataCache.set("log.md", meta);
    transport.appendFile.mockRejectedValueOnce(new Error("offline"));

    fs.appendFileSync("log.md", "more");
    await nextTask();

    expect(metadataCache.get("log.md")).toBe(meta);
    expect(contentCache.get("log.md")).toBeNull();
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("a sync read while the append is queued is replaced once the append lands", async () => {
    const { fs, transport, metadataCache } = makeAppendFs();

    metadataCache.set("log.md", { type: "file", size: 1, mtime: 1 });
    transport.readFileSync = vi
      .fn()
      .mockReturnValueOnce("C")
      .mockReturnValueOnce("Cd");

    fs.appendFileSync("log.md", "d");

    expect(fs.readFileSync("log.md", "utf8")).toBe("C");

    await nextTask();

    expect(fs.readFileSync("log.md", "utf8")).toBe("Cd");
  });

  it("a sync read while an append is queued is not cached, so a later failed append writes nothing", async () => {
    vi.useFakeTimers();

    const { fs, transport, metadataCache, contentCache } = makeAppendFs();
    const firstAppend = deferred();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("log.md", { type: "file", size: 2, mtime: 1 });
    transport.appendFile
      .mockImplementationOnce(async (path, data) => {
        transport.calls.push(`appendFile ${path} ${data}`);
        await firstAppend.promise;
      })
      .mockImplementationOnce(async (path, data) => {
        transport.calls.push(`appendFile ${path} ${data}`);
        throw new Error("offline");
      });
    transport.readFileSync = vi.fn(() => "S0");

    fs.appendFileSync("log.md", "S1");

    expect(fs.readFileSync("log.md", "utf8")).toBe("S0");
    expect(contentCache.get("log.md")).toBeNull();

    fs.appendFileSync("log.md", "S2");
    await vi.advanceTimersByTimeAsync(0);
    firstAppend.resolve();
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.calls).toEqual([
      "appendFile log.md S1",
      "appendFile log.md S2",
    ]);
    expect(transport.writeFile).not.toHaveBeenCalled();
  });

  it("an append over a retrying promises write keeps the write pending", async () => {
    vi.useFakeTimers();

    const { fs, fsp, transport, metadataCache, contentCache } = makeAppendFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("a.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("a.md", "old");
    transport.writeFile.mockRejectedValue(new Error("offline"));
    transport.appendFile.mockRejectedValue(new Error("offline"));

    await fsp.writeFile("a.md", "X");
    await vi.advanceTimersByTimeAsync(0);

    expect(listPending()).toEqual(["a.md"]);

    fs.appendFileSync("a.md", "y");
    await vi.advanceTimersByTimeAsync(0);

    expect(listPending()).toEqual(["a.md"]);
    expect(getState()).toBe("pending");
  });

  it("an append over a write that gives up keeps the unsaved text for the next append", async () => {
    vi.useFakeTimers();

    const { fs, fsp, transport, metadataCache, contentCache } = makeAppendFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("a.md", { type: "file", size: 1, mtime: 1 });
    contentCache.set("a.md", "S");
    transport.writeFile.mockRejectedValue(new Error("offline"));
    transport.appendFile.mockRejectedValue(new Error("offline"));

    await fsp.writeFile("a.md", "W");
    await vi.advanceTimersByTimeAsync(91_000);
    fs.appendFileSync("a.md", "d");
    await vi.advanceTimersByTimeAsync(0);

    expect(contentCache.get("a.md")).toBe("Wd");
    expect(fs.readFileSync("a.md", "utf8")).toBe("Wd");

    fs.appendFileSync("a.md", "e");
    await vi.advanceTimersByTimeAsync(0);
    transport.writeFile.mockResolvedValue({ mtime: 9, size: 3 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(transport.writeFile.mock.calls.at(-1)[1]).toBe("Wde");
  });
});
