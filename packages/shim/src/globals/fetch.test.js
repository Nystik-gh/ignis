import { describe, it, expect, afterEach, vi } from "vitest";
import { installFetchShim } from "./fetch.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function proxyAnswer(result) {
  return { ok: true, json: async () => result };
}

function install(
  respond = () => proxyAnswer({ status: 200, headers: {}, body: "" }),
) {
  let relayed = null;

  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: BROWSER_UA },
    configurable: true,
  });

  globalThis.window = {
    __obsidianVersion: "1.12.7",
    location: { origin: "https://ignis.test" },
    fetch: async (url, init) => {
      relayed = JSON.parse(init.body);

      return respond(init);
    },
  };

  installFetchShim();

  return () => relayed;
}

function restoreGlobals() {
  delete globalThis.window;

  if (realNavigator) {
    Object.defineProperty(globalThis, "navigator", realNavigator);
  } else {
    delete globalThis.navigator;
  }
}

function relayedBodyText(relayed) {
  return relayed.binary
    ? Buffer.from(relayed.body, "base64").toString()
    : relayed.body;
}

async function relayedHeaders(init) {
  const relayed = install();

  await window.fetch("https://example.test/api/thing", init);

  return relayed().headers;
}

describe("relayed cross-origin request headers", () => {
  afterEach(restoreGlobals);

  it("carries the desktop identity headers the caller left unset", async () => {
    const headers = await relayedHeaders();

    expect(headers["user-agent"]).toContain("obsidian/1.12.7");
    expect(headers["origin"]).toBe("app://obsidian.md");
    expect(headers["sec-ch-ua-platform"]).toBe('"Windows"');
    expect(headers["sec-ch-ua-mobile"]).toBe("?0");
    expect(headers["priority"]).toBe("u=1, i");
    expect(headers["sec-fetch-mode"]).toBe("cors");
    expect(headers["sec-fetch-site"]).toBe("cross-site");
  });

  it("never overrides a header the caller set", async () => {
    const caller = {
      "user-agent": "caller-agent",
      origin: "https://caller.test",
      "sec-ch-ua-platform": '"Android"',
      "sec-ch-ua-mobile": "?1",
      priority: "u=4",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "same-site",
    };

    const headers = await relayedHeaders({
      method: "POST",
      headers: caller,
      body: "{}",
    });

    expect(headers).toMatchObject(caller);
  });
});

describe("the proxied-request log line", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreGlobals();
  });

  it("shows the origin and path without the query string or fragment", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    install();

    await window.fetch(
      "https://example.test/api/thing?key=SECRET&sig=abc#frag",
    );

    const line = log.mock.calls.find((args) =>
      String(args[0]).startsWith("[shim:fetch]"),
    );

    expect(line).toEqual([
      "[shim:fetch] Proxying cross-origin:",
      "GET",
      "https://example.test/api/thing",
    ]);
  });
});

describe("relayed request bodies", () => {
  afterEach(restoreGlobals);

  async function relay(input, init) {
    const relayed = install();

    await window.fetch(input, init);

    return relayed();
  }

  it("sends a string as text", async () => {
    const relayed = await relay("https://example.test/items", {
      method: "POST",
      body: '{"a":1}',
    });

    expect(relayed.binary).toBe(false);
    expect(relayed.body).toBe('{"a":1}');
    expect(relayed.headers["content-type"]).toBe("text/plain;charset=UTF-8");
  });

  it("sends URLSearchParams as form-encoded text", async () => {
    const relayed = await relay("https://example.test/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "code", code: "a b" }),
    });

    expect(relayed.binary).toBe(false);
    expect(relayed.body).toBe("grant_type=code&code=a+b");
    expect(relayed.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
  });

  it("sends FormData as multipart with its boundary", async () => {
    const form = new FormData();
    form.append("file", new Blob(["file bytes"]), "a.txt");

    const relayed = await relay("https://example.test/upload", {
      method: "POST",
      body: form,
    });
    const contentType = relayed.headers["content-type"];
    const boundary = contentType.split("boundary=")[1];

    expect(relayed.binary).toBe(true);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(relayedBodyText(relayed)).toContain(`--${boundary}`);
    expect(relayedBodyText(relayed)).toContain("file bytes");
  });

  it("sends a Blob as binary with the Blob's type", async () => {
    const relayed = await relay("https://example.test/object", {
      method: "PUT",
      body: new Blob(["blob bytes"], { type: "image/png" }),
    });

    expect(relayed.binary).toBe(true);
    expect(relayedBodyText(relayed)).toBe("blob bytes");
    expect(relayed.headers["content-type"]).toBe("image/png");
  });

  it("sends the body of a Request input", async () => {
    const relayed = await relay(
      new Request("https://example.test/items", {
        method: "POST",
        body: "request body",
      }),
    );

    expect(relayed.method).toBe("POST");
    expect(relayedBodyText(relayed)).toBe("request body");
  });

  it("sends no body for a DELETE without one where Request has no body property", async () => {
    const bodyDescriptor = Object.getOwnPropertyDescriptor(
      Request.prototype,
      "body",
    );

    delete Request.prototype.body;

    try {
      const relayed = await relay("https://example.test/items/1", {
        method: "DELETE",
      });

      expect(relayed.body).toBeNull();
      expect(relayed.binary).toBe(false);
    } finally {
      Object.defineProperty(Request.prototype, "body", bodyDescriptor);
    }
  });
});

describe("relayed responses", () => {
  afterEach(restoreGlobals);

  it.each([204, 205, 304])("resolves a %i with a null body", async (status) => {
    install(() => proxyAnswer({ status, headers: {}, body: "" }));

    const res = await window.fetch("https://example.test/item", {
      method: "DELETE",
    });

    expect(res.status).toBe(status);
    expect(res.body).toBeNull();
  });
});

describe("aborting a relayed request", () => {
  afterEach(restoreGlobals);

  it("rejects an already-aborted signal without contacting the proxy", async () => {
    const respond = vi.fn();
    install(respond);

    const controller = new AbortController();
    controller.abort();

    await expect(
      window.fetch("https://example.test/item", { signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(respond).not.toHaveBeenCalled();
  });

  it("rejects with an AbortError when aborted during the proxy call", async () => {
    let proxyCalled;
    const called = new Promise((resolve) => (proxyCalled = resolve));

    install(
      (init) =>
        new Promise((resolve, reject) => {
          proxyCalled();
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          setTimeout(
            () => resolve(proxyAnswer({ status: 200, headers: {}, body: "" })),
            50,
          );
        }),
    );

    const controller = new AbortController();
    const pending = window.fetch("https://example.test/item", {
      signal: controller.signal,
    });

    await called;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
