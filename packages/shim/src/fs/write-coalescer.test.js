import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initWriteCoalescer,
  bufferWrite,
  cancelPending,
  enqueue,
  enqueueMutation,
  enqueueWrite,
  hasPending,
  _reset,
} from "./write-coalescer.js";
import { isRecentSentOp } from "./echo-guard.js";
import {
  hasWriteInProgress,
  initWriteDurability,
  listFailed,
  onFailure,
  _reset as resetDurability,
} from "./write-durability.js";

function makeTransport() {
  const calls = [];

  return {
    calls,
    writeFile: vi.fn(async (path, data, encoding) => {
      calls.push({ path, data, encoding });
      return { mtime: 123, size: typeof data === "string" ? data.length : 0 };
    }),
  };
}

describe("client write coalescer", () => {
  let transport;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = makeTransport();
    initWriteCoalescer(transport);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces a burst of same-path writes into one flush with the last content", async () => {
    bufferWrite("types.json", "v1", "utf-8");
    bufferWrite("types.json", "v2", "utf-8");
    bufferWrite("types.json", "v3", "utf-8");

    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(hasPending("types.json")).toBe(true);

    await vi.advanceTimersByTimeAsync(150);

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(transport.calls[0]).toMatchObject({
      path: "types.json",
      data: "v3",
    });
    expect(hasPending("types.json")).toBe(false);
  });

  it("flushes distinct paths independently", async () => {
    bufferWrite("a.json", "a", "utf-8");
    bufferWrite("b.json", "b", "utf-8");

    await vi.advanceTimersByTimeAsync(150);

    expect(transport.writeFile).toHaveBeenCalledTimes(2);
  });

  it("marks the local op at flush time, not before, so the watcher echo is suppressed", async () => {
    bufferWrite("c.json", "c", "utf-8");

    expect(isRecentSentOp("c.json")).toBe(false);

    await vi.advanceTimersByTimeAsync(150);

    expect(isRecentSentOp("c.json")).toBe(true);
  });

  it("invokes onResult with the server result after the flush", async () => {
    const onResult = vi.fn();
    bufferWrite("d.json", "d", "utf-8", onResult);

    await vi.advanceTimersByTimeAsync(150);

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ mtime: 123 }),
    );
  });

  it("cancelPending drops a buffered write without sending it", async () => {
    bufferWrite("e.json", "e", "utf-8");
    cancelPending("e.json");

    await vi.advanceTimersByTimeAsync(2500);

    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(hasPending("e.json")).toBe(false);
  });

  it("forces a flush at the max wait under continuous writes", async () => {
    // Write faster than the quiet window so the quiet timer keeps resetting; only the max wait fires.
    for (let i = 0; i < 45; i++) {
      bufferWrite("g.json", "g" + i, "utf-8");
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(transport.writeFile).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
  });

  it("serializes same-path writes: the second does not start until the first settles", async () => {
    let releaseA;
    const started = [];

    transport.writeFile = vi.fn((path, data) => {
      started.push(data);

      if (data === "A") {
        return new Promise((res) => {
          releaseA = () => res({ mtime: 1 });
        });
      }

      return Promise.resolve({ mtime: 1 });
    });

    const pA = enqueueWrite("n.md", "A", "utf-8");
    const pB = enqueueWrite("n.md", "B", "utf-8");

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["A"]); // B is blocked behind the in-flight A

    releaseA();
    await pA;
    await pB;
    expect(started).toEqual(["A", "B"]);
  });

  it("an awaited write waits for an in-flight buffered flush to the same path (no reorder)", async () => {
    let releaseFlush;
    const started = [];

    transport.writeFile = vi.fn((path, data) => {
      started.push(data);

      if (data === "boot") {
        return new Promise((res) => {
          releaseFlush = () => res({ mtime: 1 });
        });
      }

      return Promise.resolve({ mtime: 2 });
    });

    bufferWrite("n.md", "boot", "utf-8");
    await vi.advanceTimersByTimeAsync(150);

    // The buffered flush is now in flight and no longer "pending".
    expect(started).toEqual(["boot"]);
    expect(hasPending("n.md")).toBe(false);

    const pPost = enqueueWrite("n.md", "post", "utf-8");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["boot"]); // blocked behind the in-flight flush

    releaseFlush();
    await pPost;
    expect(started).toEqual(["boot", "post"]); // strictly after the boot flush
  });
});

describe("mutation ordering", () => {
  afterEach(() => {
    _reset();
    resetDurability();
    vi.useRealTimers();
  });

  it("drops a write waiting to retry under a path the mutation removes, without waiting for it", async () => {
    vi.useFakeTimers();

    const transport = makeTransport();
    const run = vi.fn();

    transport.writeFile.mockRejectedValueOnce(new Error("offline"));
    initWriteCoalescer(transport);
    initWriteDurability(transport, enqueue);
    enqueueWrite("dir/a.md", "a", "utf-8").catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(hasWriteInProgress("dir/a.md")).toBe(true);

    await enqueueMutation(["dir"], run, { supersededPaths: ["dir"] });

    expect(run).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60000);

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(hasWriteInProgress("dir/a.md")).toBe(false);
  });

  it("a mutation on a folder waits for a write under it that already left the buffer", async () => {
    const transport = makeTransport();
    const order = [];
    let releaseWrite;

    transport.writeFile = vi.fn((path) => {
      order.push(`writeFile ${path}`);

      return new Promise((res) => {
        releaseWrite = () => res({ mtime: 1 });
      });
    });
    initWriteCoalescer(transport);

    enqueueWrite("dir/sub/a.md", "a", "utf-8").catch(() => {});

    const mutation = enqueueMutation(["dir"], () => {
      order.push("rename dir");
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["writeFile dir/sub/a.md"]);

    releaseWrite();
    await mutation;

    expect(order).toEqual(["writeFile dir/sub/a.md", "rename dir"]);
  });

  it("a mutation sends buffered writes under its paths first", async () => {
    const transport = makeTransport();
    const order = [];

    transport.writeFile = vi.fn(async (path) => {
      order.push(`writeFile ${path}`);

      return { mtime: 1 };
    });
    initWriteCoalescer(transport);

    bufferWrite("dir/a.md", "a", "utf-8");
    bufferWrite("other.md", "o", "utf-8");
    await enqueueMutation(["dir"], () => {
      order.push("rm dir");
    });

    expect(order).toEqual(["writeFile dir/a.md", "rm dir"]);
    expect(hasPending("other.md")).toBe(true);
  });
});

describe("a write rejected permanently", () => {
  afterEach(() => {
    _reset();
    resetDurability();
    vi.useRealTimers();
  });

  it("gives up at once and shows the failure", async () => {
    vi.useFakeTimers();

    const transport = makeTransport();
    const rejected = new Error("Request Entity Too Large");
    const failed = [];

    rejected.code = "UNKNOWN";
    rejected.status = 413;
    rejected.permanent = true;
    transport.writeFile.mockRejectedValue(rejected);
    initWriteCoalescer(transport);
    initWriteDurability(transport, enqueue);
    onFailure((path) => failed.push(path));

    await expect(enqueueWrite("big.png", "x", "binary")).rejects.toBe(rejected);

    expect(failed).toEqual(["big.png"]);
    expect(listFailed()).toEqual(["big.png"]);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
  });
});
