import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as wd from "./write-durability.js";

let transport;

beforeEach(() => {
  vi.useFakeTimers();
  wd._reset();
  transport = { writeFile: vi.fn().mockResolvedValue({ mtime: 1, size: 1 }) };
  wd.initWriteDurability(transport);
});

afterEach(() => {
  wd._reset();
  vi.useRealTimers();
});

describe("pending threshold", () => {
  it("does not go pending for a write that resolves before the threshold", () => {
    const track = wd.trackWrite("a.md");

    vi.advanceTimersByTime(500);
    track.success();
    vi.advanceTimersByTime(1000);

    expect(wd.getState()).toBe("clean");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("goes pending for a write still in flight past the threshold", () => {
    const track = wd.trackWrite("a.md");

    expect(wd.getState()).toBe("clean");

    vi.advanceTimersByTime(1000);

    expect(wd.getState()).toBe("pending");
    expect(wd.getDetail()).toEqual({ pending: 1, retrying: 0 });

    track.success();

    expect(wd.getState()).toBe("clean");
  });

  it("does not re-emit while a second path crosses the threshold during pending", () => {
    const seen = [];
    wd.onStateChange((s) => seen.push(s));

    const a = wd.trackWrite("a.md");
    wd.trackWrite("b.md");
    vi.advanceTimersByTime(1000);

    expect(seen).toEqual(["pending"]);

    a.success();

    expect(seen).toEqual(["pending"]);
  });
});

describe("retry on failure", () => {
  it("retries a failed write and clears once it lands", async () => {
    const track = wd.trackWrite("a.md");
    track.failure("payload", "utf-8", null);

    expect(wd.getState()).toBe("pending");
    expect(wd.getDetail()).toEqual({ pending: 1, retrying: 1 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(transport.writeFile).toHaveBeenCalledWith("a.md", "payload", "utf-8");
    expect(wd.getState()).toBe("clean");
  });

  it("runs onResult when a retry succeeds", async () => {
    const onResult = vi.fn();
    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", onResult);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onResult).toHaveBeenCalledWith({ mtime: 1, size: 1 });
  });

  it("gives up after the cap: fires onFailure, lists the path, aggregate returns clean", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    const failed = [];
    wd.onFailure((p) => failed.push(p));

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(failed).toEqual(["a.md"]);
    expect(wd.listFailed()).toEqual(["a.md"]);
    expect(wd.getState()).toBe("clean");
    expect(wd.getDetail()).toEqual({ pending: 0, retrying: 0 });
  });

  it("a lingering failed entry does not mask a later pending write", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));

    const t1 = wd.trackWrite("a.md");
    t1.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(wd.listFailed()).toEqual(["a.md"]);

    const b = wd.trackWrite("b.md");
    vi.advanceTimersByTime(1000);

    expect(wd.getState()).toBe("pending");

    b.success();

    // With b.md landed, the lingering failed a.md must not keep the aggregate pending.
    expect(wd.getState()).toBe("clean");
    expect(wd.listFailed()).toEqual(["a.md"]);
  });
});

describe("silent (config) writes", () => {
  it("never contributes to the user-facing state or detail", () => {
    const seen = [];
    wd.onStateChange((s) => seen.push(s));

    wd.trackWrite("config.json", { silent: true });
    vi.advanceTimersByTime(1000);

    expect(wd.getState()).toBe("clean");
    expect(wd.getDetail()).toEqual({ pending: 0, retrying: 0 });
    expect(seen).toEqual([]);
  });

  it("still retries on failure but never fires onFailure or lists", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    const failed = [];
    wd.onFailure((p) => failed.push(p));

    const track = wd.trackWrite("config.json", { silent: true });
    track.failure("cfg", "utf-8", null);

    await vi.advanceTimersByTimeAsync(1000);

    expect(transport.writeFile).toHaveBeenCalledWith(
      "config.json",
      "cfg",
      "utf-8",
    );

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(failed).toEqual([]);
    expect(wd.listFailed()).toEqual([]);
    expect(wd.getState()).toBe("clean");
    // A silent give-up must discard the entry, not leave it lingering in the map forever.
    expect(wd._size()).toBe(0);
  });
});

describe("supersession", () => {
  it("a fresh write supersedes a pending retry and cancels the old retry", async () => {
    const t1 = wd.trackWrite("a.md");
    t1.failure("old", "utf-8", null);

    expect(wd.getState()).toBe("pending");

    wd.trackWrite("a.md");

    expect(wd.getState()).toBe("clean");

    await vi.advanceTimersByTimeAsync(5000);

    // The old retry timer was cleared, so no write of any kind fires for the superseded entry.
    expect(transport.writeFile).not.toHaveBeenCalled();
  });

  it("a settled write under a superseded gen does not mutate the newer entry", async () => {
    let resolveOld;
    transport.writeFile.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveOld = res;
        }),
    );

    const t1 = wd.trackWrite("a.md");
    t1.failure("old", "utf-8", null);

    // Fire the retry; its transport.writeFile is now pending under gen 1.
    await vi.advanceTimersByTimeAsync(1000);

    expect(transport.writeFile).toHaveBeenCalledWith("a.md", "old", "utf-8");

    // A fresh write supersedes (gen 2) while the gen-1 write is still in flight.
    const t2 = wd.trackWrite("a.md");

    expect(wd._size()).toBe(1);

    // The gen-1 write resolves late; the gen check must keep it from discarding the gen-2 entry.
    resolveOld({ mtime: 1, size: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(wd._size()).toBe(1);

    vi.advanceTimersByTime(1000);

    expect(wd.getState()).toBe("pending");

    t2.success();

    expect(wd.getState()).toBe("clean");
  });

  it("a stale handle's failure() after supersession is a no-op", () => {
    const t1 = wd.trackWrite("a.md");
    const t2 = wd.trackWrite("a.md");

    t1.failure("stale", "utf-8", null);

    expect(wd.getState()).toBe("clean");
    expect(wd.getDetail()).toEqual({ pending: 0, retrying: 0 });

    t2.success();

    expect(wd.getState()).toBe("clean");
  });
});

describe("retryAll", () => {
  it("re-attempts a given-up write and clears on success", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(wd.listFailed()).toEqual(["a.md"]);

    transport.writeFile.mockResolvedValue({ mtime: 1, size: 1 });
    wd.retryAll();
    await vi.advanceTimersByTimeAsync(1);

    expect(wd.listFailed()).toEqual([]);
    expect(wd.getState()).toBe("clean");
  });

  it("a retried write that fails again re-enters backoff and gives up again", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    const failed = [];
    wd.onFailure((p) => failed.push(p));

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(failed).toEqual(["a.md"]);

    wd.retryAll();

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(failed).toEqual(["a.md", "a.md"]);
  });
});

describe("getDetail", () => {
  it("counts inflight-past-threshold as pending, not retrying", () => {
    wd.trackWrite("a.md");
    vi.advanceTimersByTime(1000);

    expect(wd.getDetail()).toEqual({ pending: 1, retrying: 0 });
  });

  it("counts a mix of retrying and inflight-pending", () => {
    const t1 = wd.trackWrite("a.md");
    t1.failure("d", "utf-8", null);
    wd.trackWrite("b.md");
    vi.advanceTimersByTime(1000);

    expect(wd.getDetail()).toEqual({ pending: 2, retrying: 1 });
  });
});

describe("subscriber resilience", () => {
  it("one throwing state subscriber does not block others", () => {
    const seen = [];
    wd.onStateChange(() => {
      throw new Error("bad");
    });
    wd.onStateChange((s) => seen.push(s));

    wd.trackWrite("a.md");
    vi.advanceTimersByTime(1000);

    expect(seen).toEqual(["pending"]);
  });

  it("one throwing failure subscriber does not block others", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    const seen = [];
    wd.onFailure(() => {
      throw new Error("bad");
    });
    wd.onFailure((p) => seen.push(p));

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(seen).toEqual(["a.md"]);
  });
});

describe("retry serialization", () => {
  it("routes retries through the injected serializer", async () => {
    const serialize = vi.fn((path, run) => run());
    wd.initWriteDurability(transport, serialize);

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    await vi.advanceTimersByTimeAsync(1000);

    expect(serialize).toHaveBeenCalledWith("a.md", expect.any(Function));
    expect(transport.writeFile).toHaveBeenCalledWith("a.md", "d", "utf-8");
  });

  it("skips a queued retry that a newer write superseded before its turn", async () => {
    // A serializer that holds the run until released, mimicking a slow in-flight write ahead of it.
    let release;
    const gate = new Promise((res) => {
      release = res;
    });
    const serialize = vi.fn((path, run) => gate.then(run, run));
    wd.initWriteDurability(transport, serialize);

    const t1 = wd.trackWrite("a.md");
    t1.failure("old", "utf-8", null);

    // Fire the retry: it enters the serializer but is gated, not yet dispatched.
    await vi.advanceTimersByTimeAsync(1000);

    expect(serialize).toHaveBeenCalledTimes(1);
    expect(transport.writeFile).not.toHaveBeenCalled();

    // A fresh write supersedes before the gated retry gets its turn.
    wd.trackWrite("a.md");

    // Release the gate; the retry's run sees the newer gen and must not dispatch the stale body.
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.writeFile).not.toHaveBeenCalled();
  });
});

describe("onFailureChange", () => {
  it("fires when a failed path is superseded, and listFailed drops it", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    let fired = 0;
    wd.onFailureChange(() => fired++);

    const track = wd.trackWrite("a.md");
    track.failure("d", "utf-8", null);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(wd.listFailed()).toEqual(["a.md"]);
    expect(fired).toBe(0);

    // A fresh write to the given-up path retires its failure.
    wd.trackWrite("a.md");

    expect(fired).toBe(1);
    expect(wd.listFailed()).toEqual([]);
  });

  it("does not fire when superseding a still-retrying (not yet failed) write", () => {
    let fired = 0;
    wd.onFailureChange(() => fired++);

    const t1 = wd.trackWrite("a.md");
    t1.failure("d", "utf-8", null);
    wd.trackWrite("a.md");

    expect(fired).toBe(0);
  });
});
