import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "./events.js";
import { Readable, Stream, Writable, pipeline } from "./stream.js";

describe("stream shim", () => {
  it("warns once when data-flow methods are used", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    new Readable().read();
    new Writable().write("x");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("[shim:stream]");

    warn.mockRestore();
  });

  it("initializes an inherits-style subclass through Stream.call(this)", () => {
    function Sub() {
      Stream.call(this);
    }

    Object.setPrototypeOf(Sub.prototype, Stream.prototype);

    const sub = new Sub();
    const listener = vi.fn();

    sub.on("data", listener);
    sub.emit("data", "chunk");

    expect(sub).toBeInstanceOf(EventEmitter);
    expect(listener).toHaveBeenCalledWith("chunk");
    expect(sub.pipe(sub)).toBe(sub);
  });

  it("keeps the stream classes as subclasses of Stream", () => {
    expect(new Readable()).toBeInstanceOf(Stream);
    expect(new Writable()).toBeInstanceOf(Stream);
  });

  it("returns the last stream from pipeline and fails its callback on a later tick", async () => {
    const destination = new Writable();
    const callback = vi.fn();

    expect(pipeline(new Readable(), destination, callback)).toBe(destination);
    expect(callback).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(callback.mock.calls[0][0].message).toContain(
      "stream data flow is not implemented",
    );
  });

  it("returns the last stream from pipeline without a callback", () => {
    const destination = new Writable();

    expect(pipeline(new Readable(), destination)).toBe(destination);
  });

  it("warns through the data-flow warning from pipeline", async () => {
    vi.resetModules();
    const fresh = await import("./stream.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    fresh.pipeline(new fresh.Readable(), new fresh.Writable());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("pipeline()");

    warn.mockRestore();
  });
});
