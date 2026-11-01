import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transport } from "./transport.js";

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  globalThis.fetch = fetchMock;
  globalThis.window = {
    location: { origin: "http://localhost" },
    __currentVaultId: "v",
  };
});

afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.window;
});

function lastInit() {
  return fetchMock.mock.calls.at(-1)[1];
}

describe("transport appendFile", () => {
  it("sends text as is", async () => {
    await transport.appendFile("a.md", "more");

    expect(JSON.parse(lastInit().body)).toMatchObject({
      path: "a.md",
      content: "more",
      base64: false,
    });
  });

  it("sends bytes as base64", async () => {
    await transport.appendFile("a.bin", new Uint8Array([65, 66, 67]));

    expect(JSON.parse(lastInit().body)).toMatchObject({
      path: "a.bin",
      content: "QUJD",
      base64: true,
    });
  });
});

describe("transport keepalive gating", () => {
  it("sets keepalive on a small write", async () => {
    await transport.writeFile("a.md", "hello", "utf-8");

    expect(lastInit().keepalive).toBe(true);
  });

  it("omits keepalive when the body exceeds the 64KB cap", async () => {
    await transport.writeFile("a.md", "x".repeat(70 * 1024), "utf-8");

    expect(lastInit().keepalive).toBeFalsy();
  });

  it("counts base64 inflation against the cap for binary writes", async () => {
    // 60KB of bytes inflates to ~80KB of base64, over the cap.
    await transport.writeFile("a.bin", new Uint8Array(60 * 1024));

    expect(lastInit().keepalive).toBeFalsy();
  });

  it("sets keepalive on a bodyless delete", async () => {
    await transport.unlink("a.md");

    expect(lastInit().keepalive).toBe(true);
  });

  it("does not set keepalive on a read", async () => {
    await transport.readFile("a.md", "utf8");

    expect(lastInit().keepalive).toBeUndefined();
  });
});
