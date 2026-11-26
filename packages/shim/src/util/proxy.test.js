import { describe, it, expect, afterEach, vi } from "vitest";
import { proxyFetch, openProxyStream } from "./proxy.js";

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

function framed(status, headers, body = "") {
  const preamble = Buffer.from(JSON.stringify({ status, headers }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(preamble.length);

  return Buffer.concat([length, preamble, Buffer.from(body)]);
}

function respondWith(response) {
  const calls = [];

  globalThis.window = {
    __originalFetch: async (url, opts) => {
      calls.push({ ...opts, payload: JSON.parse(opts.body) });

      return response;
    },
    dispatchEvent: vi.fn(),
  };

  return calls;
}

function streamOf(chunks, { staysOpen, cancel, failAfter } = {}) {
  let i = 0;

  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else if (failAfter) {
        controller.error(failAfter);
      } else if (!staysOpen) {
        controller.close();
      }
    },
    cancel,
  });
}

describe("the mode a proxy call asks for", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("is the envelope for proxyFetch", async () => {
    let payload = null;
    captureWith((p) => (payload = p));

    await proxyFetch({ url: "https://example.com/x" });

    expect(payload.stream).toBeUndefined();
  });

  it("is a stream for openProxyStream", async () => {
    const calls = respondWith(new Response(framed(200, {})));

    await openProxyStream({ url: "https://example.com/x" });

    expect(calls[0].payload.stream).toBe(true);
  });
});

describe("openProxyStream", () => {
  afterEach(() => {
    delete globalThis.window;
    vi.restoreAllMocks();
  });

  it("reads a preamble that arrives one byte at a time, then the body", async () => {
    const bytes = framed(206, { "x-owner": "café" }, "hello");
    respondWith(new Response(streamOf([...bytes].map((b) => Buffer.of(b)))));

    const { status, headers, body } = await openProxyStream({
      url: "https://example.com/x",
    });

    expect(status).toBe(206);
    expect(headers).toEqual({ "x-owner": "café" });
    expect(await new Response(body).text()).toBe("hello");
  });

  it("fails when the response ends inside the preamble", async () => {
    respondWith(new Response(framed(200, {}).subarray(0, 6)));

    await expect(
      openProxyStream({ url: "https://example.com/x" }),
    ).rejects.toThrow("Proxy request failed");
  });

  it("reports a block answer and throws its message and code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respondWith(
      new Response(
        JSON.stringify({
          error: "Ignis blocked a connection to stream.lan",
          code: "private-host",
          host: "stream.lan",
        }),
        { status: 403 },
      ),
    );

    await expect(
      openProxyStream({ url: "http://stream.lan/x" }),
    ).rejects.toMatchObject({
      message: "Ignis blocked a connection to stream.lan",
      code: "private-host",
    });
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("cancels the proxy response when the body is cancelled", async () => {
    const cancel = vi.fn();
    respondWith(
      new Response(
        streamOf([framed(200, {}, "a")], { staysOpen: true, cancel }),
      ),
    );

    const { body } = await openProxyStream({ url: "https://example.com/x" });
    await body.cancel("done reading");

    expect(cancel).toHaveBeenCalledWith("done reading");
  });

  it("errors the body when the proxy response breaks off", async () => {
    const failAfter = new TypeError("network error");
    respondWith(new Response(streamOf([framed(200, {}, "a")], { failAfter })));

    const { body } = await openProxyStream({ url: "https://example.com/x" });

    await expect(new Response(body).text()).rejects.toBe(failAfter);
  });

  it("reads body bytes that arrive in the preamble's chunk", async () => {
    respondWith(new Response(streamOf([framed(200, {}, "with it")])));

    const { body } = await openProxyStream({ url: "https://example.com/x" });
    const { value } = await body.getReader().read();

    expect(new TextDecoder().decode(value)).toBe("with it");
    expect(value.buffer.byteLength).toBe(value.byteLength);
  });

  it("skips an empty chunk from the proxy", async () => {
    const chunks = [
      framed(200, {}),
      new Uint8Array(0),
      new TextEncoder().encode("after"),
    ];
    respondWith(new Response(streamOf(chunks)));

    const { body } = await openProxyStream({ url: "https://example.com/x" });

    expect(await new Response(body).text()).toBe("after");
  });

  it("serves a BYOB reader", async () => {
    const chunks = [framed(200, {}), new TextEncoder().encode("hi")];
    respondWith(new Response(streamOf(chunks)));

    const { body } = await openProxyStream({ url: "https://example.com/x" });
    const reader = body.getReader({ mode: "byob" });
    const first = await reader.read(new Uint8Array(8));
    const last = await reader.read(new Uint8Array(8));

    expect(new TextDecoder().decode(first.value)).toBe("hi");
    expect(last.done).toBe(true);
  });

  it.each([
    [
      "is not JSON",
      Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from("{x")]),
    ],
    ["declares more than a megabyte", Buffer.from('{"status":200}')],
  ])(
    "fails and cancels the proxy response when the preamble %s",
    async (_, bytes) => {
      const cancel = vi.fn();
      respondWith(new Response(streamOf([bytes], { staysOpen: true, cancel })));

      await expect(
        openProxyStream({ url: "https://example.com/x" }),
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});
