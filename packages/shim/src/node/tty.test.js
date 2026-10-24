import { describe, it, expect } from "vitest";
import { isatty, ReadStream, WriteStream } from "./tty.js";

describe("tty shim", () => {
  it("reports no file descriptor as a terminal", () => {
    expect(isatty(0)).toBe(false);
    expect(isatty(1)).toBe(false);
  });

  it("throws on constructing a tty stream", () => {
    expect(() => new ReadStream(0)).toThrow(
      "tty.ReadStream() is not available in the web version.",
    );
    expect(() => new WriteStream(1)).toThrow(
      "tty.WriteStream() is not available in the web version.",
    );
  });
});
