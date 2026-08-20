import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installBuffer } from "./buffer.js";

let Buffer;

beforeEach(() => {
  const win = {};

  vi.stubGlobal("window", win);
  installBuffer();
  Buffer = win.Buffer;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Buffer.toString", () => {
  it("base64-encodes a string round-tripped through from", () => {
    expect(Buffer.from("test:test").toString("base64")).toBe("dGVzdDp0ZXN0");
  });

  it("round-trips multi-byte content through base64", () => {
    const encoded = Buffer.from("påsk😀").toString("base64");

    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("påsk😀");
  });

  it("round-trips hex in both directions", () => {
    expect(Buffer.from("test:test").toString("hex")).toBe("746573743a74657374");
    expect(Buffer.from("746573743a74657374", "hex").toString()).toBe(
      "test:test",
    );
  });

  it("round-trips every byte value through latin1", () => {
    const bytes = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }

    const latin1 = Buffer.from(bytes).toString("latin1");

    expect(latin1.length).toBe(256);
    expect([...Buffer.from(latin1, "latin1")]).toEqual([...bytes]);
  });

  it("decodes as utf-8 when no encoding is given", () => {
    expect(Buffer.from("påsk").toString()).toBe("påsk");
  });

  it("warns once per unknown encoding and falls back to utf-8", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(Buffer.from("påsk", "ucs2").toString("ucs2")).toBe("påsk");
    expect(Buffer.byteLength("påsk", "ucs2")).toBe(5);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[shim:buffer] unknown encoding "ucs2", treating as utf-8',
    );
  });
});

describe("Buffer.from inputs", () => {
  it("wraps an ArrayBuffer", () => {
    const source = new Uint8Array([116, 101, 115, 116]);

    expect(Buffer.from(source.buffer).toString()).toBe("test");
  });

  it("copies a typed array and a plain array", () => {
    expect(Buffer.from(new Uint8Array([116, 101, 115, 116])).toString()).toBe(
      "test",
    );
    expect(Buffer.from([116, 101, 115, 116]).toString()).toBe("test");
  });
});

describe("Buffer helpers", () => {
  it("keeps the encoding methods on concat output", () => {
    const joined = Buffer.concat([
      Buffer.from("test:"),
      new Uint8Array([116, 101, 115, 116]),
    ]);

    expect(joined.toString("base64")).toBe("dGVzdDp0ZXN0");
  });

  it("keeps the encoding methods on slice and subarray output", () => {
    const buf = Buffer.from("xxtest:test");

    expect(buf.slice(2).toString("base64")).toBe("dGVzdDp0ZXN0");
    expect(buf.subarray(2).toString("base64")).toBe("dGVzdDp0ZXN0");
  });

  it("allocates zeroed and filled buffers that still encode", () => {
    expect(Buffer.alloc(3).toString("hex")).toBe("000000");
    expect(Buffer.alloc(3, 0x61).toString()).toBe("aaa");
    expect(Buffer.allocUnsafe(2).length).toBe(2);
  });

  it("reports any Uint8Array as a buffer", () => {
    expect(Buffer.isBuffer(Buffer.from("test"))).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array(1))).toBe(true);
    expect(Buffer.isBuffer("test")).toBe(false);
  });

  it("measures byteLength per encoding", () => {
    expect(Buffer.byteLength("dGVzdDp0ZXN0", "base64")).toBe(9);
    expect(Buffer.byteLength("YQ==", "base64")).toBe(1);
    expect(Buffer.byteLength("746573", "hex")).toBe(3);
    expect(Buffer.byteLength("påsk", "latin1")).toBe(4);
    expect(Buffer.byteLength("påsk")).toBe(5);
  });
});
