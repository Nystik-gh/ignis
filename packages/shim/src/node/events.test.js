import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "./events.js";

describe("EventEmitter", () => {
  it("constructs with new and delivers events", () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    emitter.on("ping", listener);

    expect(emitter.emit("ping", 1, 2)).toBe(true);
    expect(listener).toHaveBeenCalledWith(1, 2);
  });

  it("initializes an inherits-style subclass through EventEmitter.call(this)", () => {
    function Sub() {
      EventEmitter.call(this);
    }

    Object.setPrototypeOf(Sub.prototype, EventEmitter.prototype);

    const first = new Sub();
    const second = new Sub();
    const listener = vi.fn();

    first.once("ping", listener);
    first.emit("ping");
    first.emit("ping");

    expect(first).toBeInstanceOf(EventEmitter);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second.listenerCount("ping")).toBe(0);
  });

  it("initializes a class subclass through super()", () => {
    class Sub extends EventEmitter {
      constructor() {
        super();
        this.label = "sub";
      }
    }

    const sub = new Sub();
    const listener = vi.fn();

    sub.on("ping", listener);
    sub.emit("ping", "x");

    expect(sub).toBeInstanceOf(EventEmitter);
    expect(sub.label).toBe("sub");
    expect(listener).toHaveBeenCalledWith("x");
  });

  it("exposes itself as EventEmitter.EventEmitter", () => {
    expect(EventEmitter.EventEmitter).toBe(EventEmitter);
  });
});

describe("EventEmitter.setMaxListeners", () => {
  afterEach(() => {
    EventEmitter.defaultMaxListeners = 10;
  });

  it("sets the limit on each emitter target and skips event targets", () => {
    const first = new EventEmitter();
    const second = new EventEmitter();

    EventEmitter.setMaxListeners(
      25,
      first,
      second,
      new AbortController().signal,
    );

    expect(first.getMaxListeners()).toBe(25);
    expect(second.getMaxListeners()).toBe(25);
    expect(EventEmitter.defaultMaxListeners).toBe(10);
  });

  it("sets the default for emitters without their own limit when given no targets", () => {
    const own = new EventEmitter().setMaxListeners(3);

    EventEmitter.setMaxListeners(40);

    expect(new EventEmitter().getMaxListeners()).toBe(40);
    expect(own.getMaxListeners()).toBe(3);
  });
});

describe("EventEmitter.once", () => {
  it("resolves with the event's arguments and removes its listeners", async () => {
    const emitter = new EventEmitter();
    const done = EventEmitter.once(emitter, "finish");

    emitter.emit("finish", 1, 2);

    await expect(done).resolves.toEqual([1, 2]);
    expect(emitter.listenerCount("finish")).toBe(0);
    expect(emitter.listenerCount("error")).toBe(0);
  });

  it("rejects with an error emitted first and removes its listeners", async () => {
    const emitter = new EventEmitter();
    const failure = new Error("disk full");
    const done = EventEmitter.once(emitter, "finish");

    emitter.emit("error", failure);

    await expect(done).rejects.toBe(failure);
    expect(emitter.listenerCount("finish")).toBe(0);
    expect(emitter.listenerCount("error")).toBe(0);
  });

  it("rejects with an AbortError when the signal aborts", async () => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const done = EventEmitter.once(emitter, "finish", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(done).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
    });
    expect(emitter.listenerCount("finish")).toBe(0);
    expect(emitter.listenerCount("error")).toBe(0);
  });

  it("rejects at once on an already aborted signal", async () => {
    const emitter = new EventEmitter();

    await expect(
      EventEmitter.once(emitter, "finish", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(emitter.listenerCount("finish")).toBe(0);
  });

  it("resolves with the event from an EventTarget", async () => {
    const target = new EventTarget();
    const event = new Event("ready");
    const done = EventEmitter.once(target, "ready");

    target.dispatchEvent(event);

    await expect(done).resolves.toEqual([event]);
  });
});
