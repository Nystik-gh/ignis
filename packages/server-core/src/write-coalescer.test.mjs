import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);
const coalescer = require("./write-coalescer.js");

const SHORT_WINDOW_MS = 50;

let tmpDir;

beforeEach(async () => {
  coalescer.configure({ writeCoalesceMs: SHORT_WINDOW_MS });
  coalescer._reset();
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coalesce-test-"));
});

afterEach(async () => {
  coalescer._reset();
  vi.restoreAllMocks();
  coalescer.configure({ writeCoalesceMs: 0 });
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("writeCoalesced", () => {
  it("first write hits disk immediately with real mtime/size", async () => {
    const filePath = path.join(tmpDir, "file.txt");
    const result = await coalescer.writeCoalesced(filePath, "hello", "utf-8");

    expect(result.size).toBe(5);
    expect(result.mtime).toBeGreaterThan(0);

    const onDisk = await fs.promises.readFile(filePath, "utf-8");
    expect(onDisk).toBe("hello");
  });

  it("buffered write within the window returns immediately with synthetic values and is not yet on disk", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");

    const start = Date.now();
    const result = await coalescer.writeCoalesced(filePath, "second", "utf-8");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(result.size).toBe(6);

    const onDisk = await fs.promises.readFile(filePath, "utf-8");
    expect(onDisk).toBe("first");
  });

  it("flushes the latest buffered data after the window elapses", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "v1", "utf-8");
    await coalescer.writeCoalesced(filePath, "v2", "utf-8");
    await coalescer.writeCoalesced(filePath, "v3", "utf-8");

    await sleep(SHORT_WINDOW_MS + 30);

    const onDisk = await fs.promises.readFile(filePath, "utf-8");
    expect(onDisk).toBe("v3");
  });

  it("collapses many rapid writes into exactly two disk writes", async () => {
    const filePath = path.join(tmpDir, "file.txt");
    const spy = vi.spyOn(fs.promises, "writeFile");

    for (let i = 0; i < 20; i++) {
      await coalescer.writeCoalesced(filePath, `v${i}`, "utf-8");
    }

    await sleep(SHORT_WINDOW_MS + 30);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stays snappy when the filesystem is slow", async () => {
    const filePath = path.join(tmpDir, "file.txt");
    const realWrite = fs.promises.writeFile.bind(fs.promises);

    vi.spyOn(fs.promises, "writeFile").mockImplementation(async (...args) => {
      await sleep(200);
      return realWrite(...args);
    });

    await coalescer.writeCoalesced(filePath, "first", "utf-8");

    const start = Date.now();
    await coalescer.writeCoalesced(filePath, "second", "utf-8");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(20);
  });

  it("returns synthetic metadata when the file is deleted before the post-write stat", async () => {
    const filePath = path.join(tmpDir, "race.txt");
    vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await coalescer.writeCoalesced(filePath, "hello", "utf-8");

    expect(result.size).toBe(5);
    expect(result.mtime).toBeGreaterThan(0);
  });
});

describe("getPending", () => {
  it("returns buffered data for paths with a pending write", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");
    await coalescer.writeCoalesced(filePath, "buffered", "utf-8");

    const pending = coalescer.getPending(filePath);
    expect(pending).not.toBeNull();
    expect(pending.data).toBe("buffered");
  });
});

describe("flushAll", () => {
  it("drains all buffered writes to disk and clears pending state", async () => {
    const fileA = path.join(tmpDir, "a.txt");
    const fileB = path.join(tmpDir, "b.txt");

    await coalescer.writeCoalesced(fileA, "first-a", "utf-8");
    await coalescer.writeCoalesced(fileA, "buffered-a", "utf-8");
    await coalescer.writeCoalesced(fileB, "first-b", "utf-8");
    await coalescer.writeCoalesced(fileB, "buffered-b", "utf-8");

    expect(coalescer.getPending(fileA)).not.toBeNull();
    expect(coalescer.getPending(fileB)).not.toBeNull();

    await coalescer.flushAll();

    expect(await fs.promises.readFile(fileA, "utf-8")).toBe("buffered-a");
    expect(await fs.promises.readFile(fileB, "utf-8")).toBe("buffered-b");
    expect(coalescer.getPending(fileA)).toBeNull();
    expect(coalescer.getPending(fileB)).toBeNull();
  });
});

describe("cancelPending", () => {
  it("drops a buffered write so a deleted file does not resurrect", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");
    await coalescer.writeCoalesced(filePath, "second", "utf-8");
    await fs.promises.unlink(filePath);

    expect(coalescer.cancelPending(filePath)).toBe(true);

    await sleep(SHORT_WINDOW_MS + 30);

    await expect(fs.promises.access(filePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(coalescer.getPending(filePath)).toBeNull();
  });

  it("returns false when nothing is pending for the path", () => {
    expect(coalescer.cancelPending(path.join(tmpDir, "absent.txt"))).toBe(false);
  });
});

describe("flushPending", () => {
  it("writes the latest buffered data to disk ahead of the debounce timer", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");
    await coalescer.writeCoalesced(filePath, "second", "utf-8");

    expect(await coalescer.flushPending(filePath)).toBe(true);
    expect(await fs.promises.readFile(filePath, "utf-8")).toBe("second");
    expect(coalescer.getPending(filePath)).toBeNull();
  });

  it("returns false when nothing is pending for the path", async () => {
    expect(await coalescer.flushPending(path.join(tmpDir, "absent.txt"))).toBe(
      false,
    );
  });
});

describe("cancelPendingSubtree", () => {
  it("drops buffered writes at or under a directory and leaves siblings and outsiders", async () => {
    const dir = path.join(tmpDir, "sub");
    const sibling = path.join(tmpDir, "subling");
    await fs.promises.mkdir(dir);
    await fs.promises.mkdir(sibling);

    const inside = [path.join(dir, "a.txt"), path.join(dir, "b.txt")];
    const outside = [path.join(tmpDir, "c.txt"), path.join(sibling, "d.txt")];

    for (const f of [...inside, ...outside]) {
      await coalescer.writeCoalesced(f, "first", "utf-8");
      await coalescer.writeCoalesced(f, "buffered", "utf-8");
    }

    expect(coalescer.cancelPendingSubtree(dir)).toBe(2);

    for (const f of inside) {
      expect(coalescer.getPending(f)).toBeNull();
    }

    for (const f of outside) {
      expect(coalescer.getPending(f)).not.toBeNull();
    }
  });
});

describe("flushPendingSubtree", () => {
  it("flushes buffered writes at or under a directory to disk and clears them", async () => {
    const dir = path.join(tmpDir, "sub");
    await fs.promises.mkdir(dir);

    const a = path.join(dir, "a.txt");
    const b = path.join(dir, "b.txt");
    const outside = path.join(tmpDir, "c.txt");

    for (const f of [a, b, outside]) {
      await coalescer.writeCoalesced(f, "first", "utf-8");
      await coalescer.writeCoalesced(f, "buffered", "utf-8");
    }

    expect(await coalescer.flushPendingSubtree(dir)).toBe(2);

    expect(await fs.promises.readFile(a, "utf-8")).toBe("buffered");
    expect(await fs.promises.readFile(b, "utf-8")).toBe("buffered");
    expect(coalescer.getPending(a)).toBeNull();
    expect(coalescer.getPending(b)).toBeNull();
    expect(coalescer.getPending(outside)).not.toBeNull();
  });
});

describe("flush-failure durability", () => {
  it("flushPending retains the buffer and retries when the disk write fails", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");
    await coalescer.writeCoalesced(filePath, "second", "utf-8");

    vi.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );

    await expect(coalescer.flushPending(filePath)).rejects.toThrow();

    expect(coalescer.getPending(filePath)).not.toBeNull();
    expect(coalescer.getPending(filePath).data).toBe("second");

    await sleep(SHORT_WINDOW_MS + 50);

    expect(await fs.promises.readFile(filePath, "utf-8")).toBe("second");
    expect(coalescer.getPending(filePath)).toBeNull();
  });

  it("the debounce flush retains the buffer and retries when the disk write fails", async () => {
    const filePath = path.join(tmpDir, "file.txt");

    await coalescer.writeCoalesced(filePath, "first", "utf-8");
    await coalescer.writeCoalesced(filePath, "second", "utf-8");

    vi.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );

    await sleep(SHORT_WINDOW_MS + 50);

    expect(coalescer.getPending(filePath)).not.toBeNull();

    await sleep(SHORT_WINDOW_MS + 50);

    expect(await fs.promises.readFile(filePath, "utf-8")).toBe("second");
    expect(coalescer.getPending(filePath)).toBeNull();
  });
});
