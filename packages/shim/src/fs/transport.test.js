import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transport } from "./transport.js";

let fetchMock;

function response({
  status = 200,
  contentType = "application/json; charset=utf-8",
  redirected = false,
  body = {},
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "status " + status,
    redirected,
    headers: {
      get: (name) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    json: async () => {
      if (typeof body === "string") {
        throw new SyntaxError("Unexpected token");
      }

      return body;
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function servedType(url) {
  const { pathname, searchParams } = new URL(url);

  if (pathname !== "/api/fs/readFile") {
    return "application/json; charset=utf-8";
  }

  const encoding = searchParams.get("encoding");

  return encoding === "utf8" || encoding === "utf-8"
    ? "text/plain; charset=utf-8"
    : "application/octet-stream";
}

beforeEach(() => {
  fetchMock = vi.fn(async (url) =>
    response({ contentType: servedType(url), body: {} }),
  );
  globalThis.fetch = fetchMock;
  globalThis.window = {
    location: { origin: "http://localhost" },
    __currentVaultId: "v",
  };
});

afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.window;
  delete globalThis.XMLHttpRequest;
  vi.useRealTimers();
});

function lastInit() {
  return fetchMock.mock.calls.at(-1)[1];
}

function hangUntilAborted(url, init) {
  return new Promise((resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

async function settledError(promise) {
  let error = null;

  promise.catch((e) => {
    error = e;
  });
  await vi.advanceTimersByTimeAsync(0);

  return () => error;
}

describe("transport request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("aborts a request with no response headers after 30 s as ETIMEDOUT", async () => {
    fetchMock.mockImplementation(hangUntilAborted);

    const errorOf = await settledError(transport.stat("a.md"));

    await vi.advanceTimersByTimeAsync(29_999);

    expect(errorOf()).toBe(null);

    await vi.advanceTimersByTimeAsync(1);

    expect(errorOf()).toMatchObject({ code: "ETIMEDOUT" });
    expect(errorOf().permanent).toBeFalsy();
  });

  it("does not abort once the response headers arrived", async () => {
    await transport.readFile("a.md", "utf8");

    const signal = lastInit().signal;

    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(signal.aborted).toBe(false);
  });

  it("adds 1 s per 64 KiB of request body to the limit", async () => {
    fetchMock.mockImplementation(hangUntilAborted);

    const errorOf = await settledError(
      transport.writeFile("big.bin", new Uint8Array(500 * 1024)),
    );
    const bodyBytes = new TextEncoder().encode(lastInit().body).length;
    const limit = 30_000 + Math.ceil(bodyBytes / (64 * 1024)) * 1000;

    expect(limit).toBeGreaterThan(30_000 + 10 * 1000);

    await vi.advanceTimersByTimeAsync(limit - 1);

    expect(errorOf()).toBe(null);

    await vi.advanceTimersByTimeAsync(1);

    expect(errorOf()).toMatchObject({ code: "ETIMEDOUT" });
  });

  it("passes a network failure through unchanged", async () => {
    const failure = new TypeError("Failed to fetch");

    fetchMock.mockRejectedValue(failure);

    await expect(transport.stat("a.md")).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("transport refuses a response the fs routes did not send", () => {
  it("refuses a redirected response", async () => {
    fetchMock.mockResolvedValue(
      response({
        redirected: true,
        contentType: "text/html",
        body: "<html>sign in</html>",
      }),
    );

    const error = await transport.readFile("a.md", "utf8").catch((e) => e);

    expect(error).toMatchObject({ code: "EREDIRECT" });
    expect(error.permanent).toBeFalsy();
  });

  it("refuses a text read answered with another content type", async () => {
    fetchMock.mockResolvedValue(
      response({ contentType: "text/html", body: "<html>sign in</html>" }),
    );

    const error = await transport.readFile("a.md", "utf8").catch((e) => e);

    expect(error).toMatchObject({ code: "ECONTENTTYPE" });
    expect(error.permanent).toBeFalsy();
  });

  it("refuses a JSON endpoint answered with HTML", async () => {
    fetchMock.mockResolvedValue(
      response({ contentType: "text/html", body: "<html>sign in</html>" }),
    );

    await expect(transport.stat("a.md")).rejects.toMatchObject({
      code: "ECONTENTTYPE",
    });
    await expect(transport.writeFile("a.md", "x")).rejects.toMatchObject({
      code: "ECONTENTTYPE",
    });
  });

  it("accepts the types the fs routes send", async () => {
    fetchMock.mockImplementation(async (url) =>
      response({ contentType: servedType(url), body: { type: "file" } }),
    );

    await expect(transport.readFile("a.md", "utf8")).resolves.toBe(
      JSON.stringify({ type: "file" }),
    );
    await expect(transport.readFile("a.png")).resolves.toBeInstanceOf(
      Uint8Array,
    );
    await expect(transport.stat("a.md")).resolves.toEqual({ type: "file" });
  });

  it("answers a 304 tree fetch as not modified", async () => {
    fetchMock.mockResolvedValue({
      ...response({ status: 304, contentType: null }),
      headers: {
        get: (name) => (name.toLowerCase() === "etag" ? '"e1"' : null),
      },
    });

    await expect(transport.fetchTree('"e1"')).resolves.toEqual({
      notModified: true,
      etag: '"e1"',
    });
    expect(lastInit().headers).toMatchObject({ "If-None-Match": '"e1"' });
  });
});

describe("transport error status", () => {
  it("marks a 4xx answer permanent and keeps the server's code", async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 403,
        body: { error: "Path traversal rejected", code: "EACCES" },
      }),
    );

    const error = await transport.writeFile("a.md", "x").catch((e) => e);

    expect(error).toMatchObject({
      code: "EACCES",
      status: 403,
      permanent: true,
    });
  });

  it("marks a proxy's 413 without a JSON body permanent", async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 413,
        contentType: "text/html",
        body: "<html>413 Request Entity Too Large</html>",
      }),
    );

    const error = await transport.writeFile("a.md", "x").catch((e) => e);

    expect(error).toMatchObject({
      code: "UNKNOWN",
      status: 413,
      permanent: true,
    });
  });

  it.each([408, 429, 500, 502])("keeps a %i transient", async (status) => {
    fetchMock.mockResolvedValue(response({ status, body: { error: "busy" } }));

    const error = await transport.writeFile("a.md", "x").catch((e) => e);

    expect(error.status).toBe(status);
    expect(error.permanent).toBe(false);
  });
});

describe("transport readFileSync", () => {
  function installXhr({
    status = 200,
    contentType = "text/plain; charset=utf-8",
    responseText = "",
    responseURL,
  }) {
    globalThis.XMLHttpRequest = class {
      open(method, url) {
        this.url = url;
      }

      setRequestHeader() {}

      send() {
        this.status = status;
        this.responseText = responseText;
        this.responseURL = responseURL ?? this.url;
      }

      getResponseHeader(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      }
    };
  }

  it("returns the text the route sent", () => {
    installXhr({ responseText: "hello" });

    expect(transport.readFileSync("a.md", "utf8")).toBe("hello");
  });

  it("refuses a redirected response", () => {
    installXhr({
      contentType: "text/html",
      responseText: "<html>sign in</html>",
      responseURL: "http://localhost/cdn-cgi/access/login",
    });

    expect(() => transport.readFileSync("a.md", "utf8")).toThrow(
      expect.objectContaining({ code: "EREDIRECT" }),
    );
  });

  it("refuses another content type", () => {
    installXhr({ contentType: "text/html", responseText: "<html></html>" });

    expect(() => transport.readFileSync("a.md", "utf8")).toThrow(
      expect.objectContaining({ code: "ECONTENTTYPE" }),
    );
  });

  it("marks a 4xx answer permanent", () => {
    installXhr({
      status: 404,
      contentType: "application/json",
      responseText: JSON.stringify({ error: "ENOENT", code: "ENOENT" }),
    });

    expect(() => transport.readFileSync("a.md", "utf8")).toThrow(
      expect.objectContaining({ code: "ENOENT", status: 404, permanent: true }),
    );
  });
});

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
