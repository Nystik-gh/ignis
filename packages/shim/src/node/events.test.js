import { describe, it, expect, vi } from "vitest";
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
