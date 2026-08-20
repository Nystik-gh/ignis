import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import * as wd from "./write-durability.js";

const handlers = new Map();

globalThis.window = {
  addEventListener: (type, fn) => handlers.set(type, fn),
  removeEventListener: (type) => handlers.delete(type),
};

globalThis.document = {
  visibilityState: "visible",
  addEventListener: (type, fn) => handlers.set("document:" + type, fn),
};

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

afterAll(() => {
  delete globalThis.window;
  delete globalThis.document;
});

function firePagehide() {
  handlers.get("pagehide")();
}

function fireHidden() {
  globalThis.document.visibilityState = "hidden";
  handlers.get("document:visibilitychange")();
  globalThis.document.visibilityState = "visible";
}

function settle() {
  return vi.advanceTimersByTimeAsync(0);
}

async function giveUp(track) {
  track.failure("d", "utf-8", null);

  for (let i = 0; i < 9; i++) {
    await vi.advanceTimersByTimeAsync(30000);
  }
}

describe("unload flush", () => {
  it("pulls a retrying write forward on pagehide", () => {
    const track = wd.trackWrite("a.md");
    track.failure("payload", "utf-8", null);

    firePagehide();

    expect(transport.writeFile).toHaveBeenCalledWith(
      "a.md",
      "payload",
      "utf-8",
    );
  });

  it("pulls a retrying write forward when the page goes hidden", () => {
    const track = wd.trackWrite("a.md");
    track.failure("payload", "utf-8", null);

    fireHidden();

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
  });

  it("pulls a silent retrying write forward", () => {
    const track = wd.trackWrite("cfg.json", { silent: true });
    track.failure("cfg", "utf-8", null);

    firePagehide();

    expect(transport.writeFile).toHaveBeenCalledWith(
      "cfg.json",
      "cfg",
      "utf-8",
    );
  });

  it("discards an entry whose pulled-forward write lands", async () => {
    const track = wd.trackWrite("a.md");
    track.failure("payload", "utf-8", null);

    fireHidden();
    await settle();

    expect(wd._size()).toBe(0);
    expect(wd.getState()).toBe("clean");
    expect(vi.getTimerCount()).toBe(0);

    // verify a second hidden event re-sends nothing.
    fireHidden();

    expect(transport.writeFile).toHaveBeenCalledTimes(1);
  });

  it("revives a given-up write and re-attempts it", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    await giveUp(wd.trackWrite("a.md"));

    expect(wd.listFailed()).toEqual(["a.md"]);

    transport.writeFile.mockClear();
    transport.writeFile.mockResolvedValue({ mtime: 1, size: 1 });

    firePagehide();
    await settle();

    expect(transport.writeFile).toHaveBeenCalledWith("a.md", "d", "utf-8");
    expect(wd.listFailed()).toEqual([]);
    expect(wd._size()).toBe(0);
  });

  it("keeps a revived write in the retry machinery when it fails again", async () => {
    transport.writeFile.mockRejectedValue(new Error("offline"));
    await giveUp(wd.trackWrite("a.md"));

    firePagehide();
    await settle();

    expect(wd.getState()).toBe("pending");
    expect(wd.listPending()).toEqual(["a.md"]);

    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    expect(wd.listFailed()).toEqual(["a.md"]);
  });

  it("re-issues a large body, leaving the keepalive decision to transport", () => {
    const big = "x".repeat(64 * 1024 + 1);
    const track = wd.trackWrite("big.md");
    track.failure(big, "utf-8", null);

    firePagehide();

    expect(transport.writeFile).toHaveBeenCalledWith("big.md", big, "utf-8");
  });

  it("skips a write still in flight, which has no body to re-issue", () => {
    wd.trackWrite("a.md");

    firePagehide();

    expect(transport.writeFile).not.toHaveBeenCalled();
  });
});
