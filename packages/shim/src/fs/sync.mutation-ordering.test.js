import { describe, it, expect, vi, afterEach } from "vitest";
import { createFsSync } from "./sync.js";
import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";
import {
  enqueue,
  initWriteCoalescer,
  _reset as resetCoalescer,
} from "./write-coalescer.js";
import {
  initWriteDurability,
  _reset as resetDurability,
} from "./write-durability.js";

describe("sync mutations after unsent writes", () => {
  const nextTask = () => new Promise((r) => setTimeout(r, 0));

  function makeRecordingFs() {
    const calls = [];
    const transport = {
      calls,
      writeFile: vi.fn(async (path) => {
        calls.push(`writeFile ${path}`);

        return { mtime: 5, size: 1 };
      }),
      rename: vi.fn(async (from, to) => {
        calls.push(`rename ${from} ${to}`);
      }),
      rm: vi.fn(async (path) => {
        calls.push(`rm ${path}`);
      }),
      mkdir: vi.fn(async (path) => {
        calls.push(`mkdir ${path}`);
      }),
      appendFile: vi.fn(async (path) => {
        calls.push(`appendFile ${path}`);
      }),
      copyFile: vi.fn(async (src, dest) => {
        calls.push(`copyFile ${src} ${dest}`);
      }),
      stat: vi.fn(async () => ({ type: "file", size: 99, mtime: 77 })),
    };
    const metadataCache = new MetadataCache();
    const contentCache = new ContentCache();

    initWriteCoalescer(transport);
    initWriteDurability(transport, enqueue);

    return {
      fs: createFsSync(metadataCache, contentCache, transport),
      transport,
      metadataCache,
      contentCache,
    };
  }

  afterEach(() => {
    resetCoalescer();
    resetDurability();
    vi.restoreAllMocks();
  });

  it("writeFileSync then renameSync reaches the transport as write, then rename", async () => {
    const { fs, transport, metadataCache } = makeRecordingFs();

    fs.writeFileSync("state.json.tmp", "new");
    fs.renameSync("state.json.tmp", "state.json");
    await nextTask();

    expect(transport.calls).toEqual([
      "writeFile state.json.tmp",
      "rename state.json.tmp state.json",
    ]);
    expect(metadataCache.has("state.json.tmp")).toBe(false);
    expect(metadataCache.has("state.json")).toBe(true);
  });

  it("mkdirSync after rmSync of the same folder reaches the transport after the remove", async () => {
    const { fs, transport, metadataCache } = makeRecordingFs();

    metadataCache.set("cache", { type: "directory" });
    metadataCache.set("cache/a", { type: "file", size: 1 });

    fs.rmSync("cache", { recursive: true });
    fs.mkdirSync("cache");
    await nextTask();

    expect(transport.calls).toEqual(["rm cache", "mkdir cache"]);
    expect(metadataCache.get("cache")).toEqual({ type: "directory" });
  });

  it("writeFileSync after appendFileSync keeps the written content and metadata", async () => {
    const { fs, metadataCache, contentCache } = makeRecordingFs();

    metadataCache.set("log.md", { type: "file", size: 1, mtime: 1 });

    fs.appendFileSync("log.md", "more");
    fs.writeFileSync("log.md", "replaced");
    await nextTask();
    await nextTask();

    expect(contentCache.get("log.md")).toBe("replaced");
    expect(metadataCache.get("log.md")).toMatchObject({ size: 1, mtime: 5 });
  });

  it("writeFileSync to the destination after copyFileSync keeps the written content and metadata", async () => {
    const { fs, metadataCache, contentCache } = makeRecordingFs();

    metadataCache.set("src.md", { type: "file", size: 3, mtime: 1 });
    contentCache.set("src.md", "src");

    fs.copyFileSync("src.md", "dest.md");
    fs.writeFileSync("dest.md", "written");
    await nextTask();
    await nextTask();

    expect(contentCache.get("dest.md")).toBe("written");
    expect(metadataCache.get("dest.md")).toMatchObject({ size: 1, mtime: 5 });
  });

  it("a failed copyFileSync does not bring back a destination renamed after it", async () => {
    const { fs, transport, metadataCache, contentCache } = makeRecordingFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("src.md", { type: "file", size: 3 });
    contentCache.set("src.md", "src");
    metadataCache.set("dest.md", { type: "file", size: 4 });
    contentCache.set("dest.md", "orig");
    transport.copyFile.mockRejectedValueOnce(new Error("EIO"));

    fs.copyFileSync("src.md", "dest.md");
    fs.renameSync("dest.md", "moved.md");
    await nextTask();
    await nextTask();

    expect(metadataCache.keys().sort()).toEqual(["moved.md", "src.md"]);
    expect(contentCache.get("dest.md")).toBeNull();
  });

  it("a failed renameSync does not bring back a destination removed after it", async () => {
    const { fs, transport, metadataCache, contentCache } = makeRecordingFs();

    vi.spyOn(console, "error").mockImplementation(() => {});
    metadataCache.set("a.md", { type: "file", size: 1 });
    metadataCache.set("b.md", { type: "file", size: 2 });
    contentCache.set("b.md", "bb");
    transport.rename.mockRejectedValueOnce(new Error("EIO"));

    fs.renameSync("a.md", "b.md");
    fs.rmSync("b.md");
    await nextTask();
    await nextTask();

    expect(metadataCache.keys().sort()).toEqual(["a.md"]);
    expect(contentCache.get("b.md")).toBeNull();
  });
});
