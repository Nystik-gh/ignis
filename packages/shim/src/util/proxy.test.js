import { describe, it, expect, afterEach } from "vitest";
import { proxyFetch } from "./proxy.js";

function fakeResponse() {
  return {
    ok: true,
    json: async () => ({ status: 200, headers: {}, body: "" }),
  };
}

// proxyFetch reads window.__originalFetch to reach the server proxy.
function captureWith(handler) {
  globalThis.window = {
    __originalFetch: async (url, opts) => {
      handler(JSON.parse(opts.body));
      return fakeResponse();
    },
  };
}

describe("proxyFetch binary body encoding", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("encodes only a Uint8Array view's own region, not its backing buffer", async () => {
    let payload = null;
    captureWith((p) => (payload = p));

    const pool = new Uint8Array(32);

    for (let i = 0; i < pool.length; i++) {
      pool[i] = i;
    }

    const view = pool.subarray(8, 20); // 12 bytes at offset 8

    await proxyFetch({
      url: "https://example.com/x",
      method: "PUT",
      body: view,
    });

    expect(payload.binary).toBe(true);
    const decoded = Buffer.from(payload.body, "base64");
    expect(decoded.length).toBe(view.byteLength);
    expect([...decoded]).toEqual([...view]);
  });

  it("encodes a full ArrayBuffer", async () => {
    let payload = null;
    captureWith((p) => (payload = p));

    const body = new Uint8Array([1, 2, 3, 4, 5]).buffer;

    await proxyFetch({ url: "https://example.com/x", method: "PUT", body });

    expect(payload.binary).toBe(true);
    const decoded = Buffer.from(payload.body, "base64");
    expect([...decoded]).toEqual([1, 2, 3, 4, 5]);
  });

  it("passes a string body through untouched and unflagged", async () => {
    let payload = null;
    captureWith((p) => (payload = p));

    await proxyFetch({
      url: "https://example.com/x",
      method: "PUT",
      body: "héllo \u{1F600}",
    });

    expect(payload.binary).toBe(false);
    expect(payload.body).toBe("héllo \u{1F600}");
  });
});
