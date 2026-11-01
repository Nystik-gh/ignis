import { describe, it, expect, vi, afterEach } from "vitest";
import { createFsPromises } from "./promises.js";
import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";
import { _reset as resetCoalescer } from "./write-coalescer.js";
import { listPending, _reset as resetDurability } from "./write-durability.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

function makeRecordingTransport() {
  const calls = [];

  return {
    calls,
    writeFile: vi.fn(async (path) => {
      calls.push(`writeFile ${path}`);

      return { mtime: 5, size: 1 };
    }),
    rename: vi.fn(async (from, to) => {
      calls.push(`rename ${from} ${to}`);
    }),
    unlink: vi.fn(async (path) => {
      calls.push(`unlink ${path}`);
    }),
    rm: vi.fn(async (path) => {
      calls.push(`rm ${path}`);
    }),
    rmdir: vi.fn(async (path) => {
      calls.push(`rmdir ${path}`);
    }),
    appendFile: vi.fn(async (path) => {
      calls.push(`appendFile ${path}`);
    }),
    copyFile: vi.fn(async (src, dest) => {
      calls.push(`copyFile ${src} ${dest}`);
    }),
    stat: vi.fn(async () => ({ type: "file", size: 1 })),
  };
}

function makeFs(transport) {
  const metadataCache = new MetadataCache();
  const contentCache = new ContentCache();
  const fs = createFsPromises(metadataCache, contentCache, transport);

  return { fs, metadataCache, contentCache };
}

function startBoot() {
  vi.stubGlobal("window", { __ignisBooting: true });
}

describe("promises mutations after unsent writes", () => {
  afterEach(() => {
    resetCoalescer();
    resetDurability();
    vi.unstubAllGlobals();
  });

  it("removing a folder with nested files drops it from the parent listing", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    metadataCache.set("p", { type: "directory" });
    metadataCache.set("p/txn", { type: "directory" });
    metadataCache.set("p/txn/state", { type: "file", size: 1 });
    metadataCache.set("p/txn/backup", { type: "directory" });
    metadataCache.set("p/txn/backup/x.md", { type: "file", size: 1 });
    metadataCache.set("p/keep", { type: "directory" });
    metadataCache.set("p/keep/y.md", { type: "file", size: 1 });

    await fs.rm("p/txn", { recursive: true });

    expect(await fs.readdir("p")).toEqual(["keep"]);
    expect(metadataCache.has("p/txn/backup/x.md")).toBe(false);
  });

  it("a buffered write to the source reaches the transport before the rename", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    startBoot();
    await fs.writeFile("state.json.tmp", "new", "utf8");
    await fs.rename("state.json.tmp", "state.json");

    expect(transport.calls).toEqual([
      "writeFile state.json.tmp",
      "rename state.json.tmp state.json",
    ]);
    expect(metadataCache.has("state.json.tmp")).toBe(false);
    expect(metadataCache.has("state.json")).toBe(true);
  });

  it("a rename onto a path with a buffered write reaches the transport last", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    const srcMeta = { type: "file", size: 3 };

    metadataCache.set("src.md", srcMeta);
    startBoot();
    await fs.writeFile("dst.md", "superseded", "utf8");
    await fs.rename("src.md", "dst.md");

    expect(transport.calls).toEqual([
      "writeFile dst.md",
      "rename src.md dst.md",
    ]);
    expect(metadataCache.get("dst.md")).toBe(srcMeta);
  });

  it("a rename waits for a write already sent to the source", async () => {
    const transport = makeRecordingTransport();
    const { fs } = makeFs(transport);
    const write = deferred();

    transport.writeFile.mockImplementationOnce((path) => {
      transport.calls.push(`writeFile ${path}`);

      return write.promise;
    });

    const written = fs.writeFile("a.md", "data", "utf8");
    const renamed = fs.rename("a.md", "b.md");

    await new Promise((r) => setTimeout(r, 0));

    expect(transport.rename).not.toHaveBeenCalled();

    write.resolve({ mtime: 5, size: 4 });
    await written;
    await renamed;

    expect(transport.calls).toEqual(["writeFile a.md", "rename a.md b.md"]);
  });

  it("a delete reaches the transport after the buffered write it removes", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    metadataCache.set("d", { type: "directory" });
    metadataCache.set("d/sub", { type: "directory" });
    metadataCache.set("e", { type: "directory" });
    metadataCache.set("e/sub", { type: "directory" });
    startBoot();
    await fs.writeFile("d/sub/f.md", "f", "utf8");
    await fs.unlink("d/sub/f.md");
    await fs.writeFile("e/sub/g.md", "g", "utf8");
    await fs.rm("e", { recursive: true });

    expect(transport.calls).toEqual([
      "writeFile d/sub/f.md",
      "unlink d/sub/f.md",
      "writeFile e/sub/g.md",
      "rm e",
    ]);
    expect(metadataCache.has("d/sub/f.md")).toBe(false);
    expect(metadataCache.has("e/sub/g.md")).toBe(false);
  });

  it("buffered writes under a folder all reach the transport before its rename", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    metadataCache.set("dir", { type: "directory" });
    metadataCache.set("dir/sub", { type: "directory" });
    startBoot();
    await fs.writeFile("dir/a.md", "a", "utf8");
    await fs.writeFile("dir/sub/b.md", "b", "utf8");
    await fs.rename("dir", "moved");

    expect(transport.calls.slice(0, 2).sort()).toEqual([
      "writeFile dir/a.md",
      "writeFile dir/sub/b.md",
    ]);
    expect(transport.calls[2]).toBe("rename dir moved");
    expect(metadataCache.has("moved/sub/b.md")).toBe(true);
    expect(metadataCache.has("dir/sub/b.md")).toBe(false);
  });

  it("a failed rename restores both caches", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache, contentCache } = makeFs(transport);
    const srcMeta = { type: "file", size: 3 };
    const dstMeta = { type: "file", size: 5 };

    metadataCache.set("src.md", srcMeta);
    metadataCache.set("dst.md", dstMeta);
    contentCache.set("src.md", "src");
    contentCache.set("dst.md", "dst");
    transport.rename.mockRejectedValueOnce(new Error("offline"));

    await expect(fs.rename("src.md", "dst.md")).rejects.toThrow("offline");

    expect(metadataCache.get("src.md")).toBe(srcMeta);
    expect(metadataCache.get("dst.md")).toBe(dstMeta);
    expect(contentCache.get("src.md")).toBe("src");
    expect(contentCache.get("dst.md")).toBe("dst");
  });

  it("a failed delete restores both caches", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache, contentCache } = makeFs(transport);

    metadataCache.set("dir", { type: "directory" });
    metadataCache.set("dir/a.md", { type: "file", size: 1 });
    contentCache.set("dir/a.md", "a");
    transport.rm.mockRejectedValueOnce(new Error("offline"));

    await expect(fs.rm("dir", { recursive: true })).rejects.toThrow("offline");

    expect(await fs.readdir("dir")).toEqual(["a.md"]);
    expect(contentCache.get("dir/a.md")).toBe("a");
  });
});

describe("promises mutations after a write in retry backoff", () => {
  afterEach(() => {
    resetCoalescer();
    resetDurability();
  });

  function failNextWrite(transport, message) {
    transport.writeFile.mockImplementationOnce(async (path) => {
      transport.calls.push(`writeFile ${path}`);
      throw new Error(message);
    });
  }

  async function writeIntoBackoff(fs, transport, path) {
    failNextWrite(transport, "offline");
    await fs.writeFile(path, "data", "utf8");
  }

  it("a rename after a write in backoff at the source sends the retried write first", async () => {
    const transport = makeRecordingTransport();
    const { fs } = makeFs(transport);

    await writeIntoBackoff(fs, transport, "a.md");
    await fs.rename("a.md", "b.md");

    expect(transport.calls).toEqual([
      "writeFile a.md",
      "writeFile a.md",
      "rename a.md b.md",
    ]);
  });

  it("a rename fails and both caches are restored when the retried write fails", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache, contentCache } = makeFs(transport);

    await writeIntoBackoff(fs, transport, "a.md");

    const writtenMeta = metadataCache.get("a.md");

    failNextWrite(transport, "still offline");

    await expect(fs.rename("a.md", "b.md")).rejects.toThrow("still offline");

    expect(transport.rename).not.toHaveBeenCalled();
    expect(metadataCache.get("a.md")).toBe(writtenMeta);
    expect(metadataCache.has("b.md")).toBe(false);
    expect(contentCache.get("a.md")).toBe("data");
    expect(contentCache.get("b.md")).toBeNull();
  });

  it("an appendFile after a write in backoff sends the write first", async () => {
    const transport = makeRecordingTransport();
    const { fs } = makeFs(transport);

    await writeIntoBackoff(fs, transport, "log.md");
    await fs.appendFile("log.md", "more");

    expect(transport.calls).toEqual([
      "writeFile log.md",
      "writeFile log.md",
      "appendFile log.md",
    ]);
  });
});

describe("promises operations under a folder mutation", () => {
  afterEach(() => {
    resetCoalescer();
    resetDurability();
  });

  it("a write into a renamed folder waits for the rename", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const rename = deferred();

    metadataCache.set("A", { type: "directory" });
    transport.rename.mockImplementationOnce((from, to) => {
      transport.calls.push(`rename ${from} ${to}`);

      return rename.promise;
    });

    const renamed = fs.rename("A", "B");
    const written = fs.writeFile("B/x.md", "x", "utf8");

    await new Promise((r) => setTimeout(r, 0));

    expect(transport.writeFile).not.toHaveBeenCalled();

    rename.resolve();
    await renamed;
    await written;

    expect(transport.calls).toEqual(["rename A B", "writeFile B/x.md"]);
  });

  it("a write under a folder being removed waits for the remove", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const remove = deferred();

    metadataCache.set("dir", { type: "directory" });
    transport.rm.mockImplementationOnce((path) => {
      transport.calls.push(`rm ${path}`);

      return remove.promise;
    });

    const removed = fs.rm("dir", { recursive: true });
    const written = fs.writeFile("dir/x.md", "x", "utf8");

    await new Promise((r) => setTimeout(r, 0));

    expect(transport.writeFile).not.toHaveBeenCalled();

    remove.resolve();
    await removed;
    await written;

    expect(transport.calls).toEqual(["rm dir", "writeFile dir/x.md"]);
  });
});

describe("promises mutations that fail", () => {
  afterEach(() => {
    resetCoalescer();
    resetDurability();
    vi.useRealTimers();
  });

  function codedError(message, code) {
    return Object.assign(new Error(message), { code });
  }

  it("a failed rename onto a path with a write in backoff keeps that retry and its status", async () => {
    vi.useFakeTimers();

    const transport = makeRecordingTransport();
    const { fs, metadataCache, contentCache } = makeFs(transport);

    metadataCache.set("src.md", { type: "file", size: 1 });
    transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    await fs.writeFile("dst.md", "new", "utf8");
    transport.rename.mockRejectedValueOnce(codedError("offline", "UNKNOWN"));

    await expect(fs.rename("src.md", "dst.md")).rejects.toThrow("offline");

    expect(listPending()).toEqual(["dst.md"]);
    expect(contentCache.get("dst.md")).toBe("new");

    await vi.advanceTimersByTimeAsync(1000);

    expect(transport.calls).toEqual(["writeFile dst.md"]);
    expect(listPending()).toEqual([]);
  });

  it("a retry that comes due during a rename onto its path waits for the rename, then is dropped", async () => {
    vi.useFakeTimers();

    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const rename = deferred();

    metadataCache.set("src.md", { type: "file", size: 1 });
    transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    await fs.writeFile("dst.md", "old", "utf8");
    transport.rename.mockImplementationOnce((from, to) => {
      transport.calls.push(`rename ${from} ${to}`);

      return rename.promise;
    });

    const renamed = fs.rename("src.md", "dst.md");

    await vi.advanceTimersByTimeAsync(1000);

    expect(transport.calls).toEqual(["rename src.md dst.md"]);

    rename.resolve();
    await renamed;
    await vi.advanceTimersByTimeAsync(60000);

    expect(transport.calls).toEqual(["rename src.md dst.md"]);
    expect(listPending()).toEqual([]);
  });

  it("a rename that fails with ENOENT for a missing destination folder restores the source", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const srcMeta = { type: "file", size: 3 };

    metadataCache.set("src.md", srcMeta);
    transport.rename.mockRejectedValueOnce(codedError("gone", "ENOENT"));

    await expect(fs.rename("src.md", "missing/dst.md")).rejects.toThrow("gone");

    expect(metadataCache.get("src.md")).toBe(srcMeta);
    expect(metadataCache.has("missing/dst.md")).toBe(false);
  });

  it("a rename that fails with ENOENT still restores the destination it replaced", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache, contentCache } = makeFs(transport);
    const dstMeta = { type: "file", size: 5 };

    metadataCache.set("src.md", { type: "file", size: 3 });
    metadataCache.set("dst.md", dstMeta);
    contentCache.set("dst.md", "dst");
    transport.rename.mockRejectedValueOnce(codedError("gone", "ENOENT"));
    transport.stat.mockRejectedValueOnce(codedError("gone", "ENOENT"));

    await expect(fs.rename("src.md", "dst.md")).rejects.toThrow("gone");

    expect(metadataCache.keys()).toEqual(["dst.md"]);
    expect(metadataCache.get("dst.md")).toBe(dstMeta);
    expect(contentCache.get("dst.md")).toBe("dst");
  });

  it("a remove answered ENOENT drops the retry of a failed write under the folder", async () => {
    vi.useFakeTimers();

    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);

    metadataCache.set("dir", { type: "directory" });
    transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    await fs.writeFile("dir/a.md", "data", "utf8");
    transport.rm.mockRejectedValueOnce(codedError("gone", "ENOENT"));

    await expect(fs.rm("dir", { recursive: true })).rejects.toThrow("gone");
    await vi.advanceTimersByTimeAsync(1100);

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(metadataCache.has("dir")).toBe(false);
    expect(metadataCache.has("dir/a.md")).toBe(false);
    expect(listPending()).toEqual([]);
  });
});

describe("promises reads during queued operations", () => {
  afterEach(() => {
    resetCoalescer();
    resetDurability();
    vi.useRealTimers();
  });

  it("a read of an uncached file in a renamed folder waits for the rename", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const rename = deferred();

    metadataCache.set("dir", { type: "directory" });
    metadataCache.set("dir/x.md", { type: "file", size: 1, mtime: 1 });
    transport.rename.mockImplementationOnce((from, to) => {
      transport.calls.push(`rename ${from} ${to}`);

      return rename.promise;
    });
    transport.readFile = vi.fn(async (path) => {
      transport.calls.push(`readFile ${path}`);

      return "x";
    });

    const renamed = fs.rename("dir", "dir2");
    const read = fs.readFile("dir2/x.md", "utf8");

    await new Promise((r) => setTimeout(r, 0));

    expect(transport.readFile).not.toHaveBeenCalled();

    rename.resolve();
    await renamed;

    expect(await read).toBe("x");
    expect(transport.calls).toEqual(["rename dir dir2", "readFile dir2/x.md"]);
  });

  it("a read of a file removed while it waited for the queue answers ENOENT", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const rename = deferred();

    metadataCache.set("dir", { type: "directory" });
    metadataCache.set("dir/x.md", { type: "file", size: 1, mtime: 1 });
    transport.rename.mockImplementationOnce(() => rename.promise);
    transport.readFile = vi.fn(async () => "server-old");

    const renamed = fs.rename("dir", "dir2");
    const read = fs.readFile("dir2/x.md", "utf8");
    const unlinked = fs.unlink("dir2/x.md");

    rename.resolve();
    await renamed;
    await unlinked;

    await expect(read).rejects.toMatchObject({ code: "ENOENT" });
    expect(transport.readFile).not.toHaveBeenCalled();
  });

  it("a read of an uncached file does not wait for an operation on another path", async () => {
    const transport = makeRecordingTransport();
    const { fs, metadataCache } = makeFs(transport);
    const rename = deferred();

    metadataCache.set("other", { type: "directory" });
    metadataCache.set("a.md", { type: "file", size: 1, mtime: 1 });
    transport.rename.mockImplementationOnce(() => rename.promise);
    transport.readFile = vi.fn(async () => "a");

    const renamed = fs.rename("other", "moved");
    const read = fs.readFile("a.md", "utf8");

    await new Promise((r) => setTimeout(r, 0));

    expect(transport.readFile).toHaveBeenCalledWith("a.md", "utf8");

    rename.resolve();
    await renamed;

    expect(await read).toBe("a");
  });

  it("a read of an uncached file does not wait for its write's retry backoff", async () => {
    vi.useFakeTimers();

    const transport = makeRecordingTransport();
    const { fs, contentCache } = makeFs(transport);

    transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    await fs.writeFile("a.md", "data", "utf8");
    contentCache.delete("a.md");
    transport.readFile = vi.fn(async () => "server");

    const read = fs.readFile("a.md", "utf8");

    await vi.advanceTimersByTimeAsync(0);

    expect(transport.readFile).toHaveBeenCalledWith("a.md", "utf8");
    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(await read).toBe("server");
  });
});
