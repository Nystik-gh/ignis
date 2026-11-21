import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendRequest } from "./send-request.js";
import { setDirectFetchHosts } from "./url.js";

let proxied;
let direct;

function fakeProxyResponse() {
  return {
    ok: true,
    json: async () => ({ status: 200, headers: {}, body: "" }),
  };
}

function fakeDirectResponse() {
  return {
    status: 201,
    headers: new Map([["content-type", "application/json"]]),
    arrayBuffer: async () => new TextEncoder().encode("{}").buffer,
  };
}

beforeEach(() => {
  proxied = [];
  direct = [];

  globalThis.window = {
    location: { origin: "https://ignis.test" },
    __originalFetch: async (url, opts) => {
      if (url === "/api/proxy") {
        proxied.push(JSON.parse(opts.body));
        return fakeProxyResponse();
      }

      direct.push({ url, ...opts });
      return fakeDirectResponse();
    },
  };

  setDirectFetchHosts(["kavita.lan"]);
});

afterEach(() => {
  setDirectFetchHosts([]);
  delete globalThis.window;
});

describe("the Content-Type a requestUrl call asks for", () => {
  it("is added as a header when the caller set none", async () => {
    await sendRequest({
      url: "https://api.example.test/annotations",
      method: "POST",
      body: "{}",
      contentType: "application/json",
    });

    expect(proxied[0].headers).toEqual({
      "Content-Type": "application/json",
      "user-agent": expect.any(String),
    });
  });

  it("leaves a Content-Type the caller set, in any capitalization", async () => {
    await sendRequest({
      url: "https://api.example.test/annotations",
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
      contentType: "application/json",
    });

    expect(proxied[0].headers).toEqual({
      "content-type": "text/plain",
      "user-agent": expect.any(String),
    });
  });

  it("adds no Content-Type when the call names no content type", async () => {
    await sendRequest({ url: "https://api.example.test/annotations" });

    expect(proxied[0].headers).toEqual({ "user-agent": expect.any(String) });
    expect(proxied[0].method).toBe("GET");
  });
});

describe("the User-Agent a proxied requestUrl call sends", () => {
  it("is the desktop client's when the caller set none", async () => {
    window.__obsidianVersion = "1.14.4";

    await sendRequest({ url: "https://api.github.com/repos/a/b" });

    expect(proxied[0].headers["user-agent"]).toContain("obsidian/1.14.4");
  });

  it("is the caller's when set, in any capitalization", async () => {
    await sendRequest({
      url: "https://api.github.com/repos/a/b",
      headers: { "User-Agent": "caller-agent" },
    });

    expect(proxied[0].headers).toEqual({ "User-Agent": "caller-agent" });
  });
});

describe("the route a requestUrl call takes", () => {
  it("goes directly to the Ignis origin, with no User-Agent added", async () => {
    await sendRequest({ url: "https://ignis.test/api/thing" });

    expect(proxied).toEqual([]);
    expect(direct[0].headers).toEqual({});
  });

  it("goes directly to a direct-fetch host, with the Content-Type applied", async () => {
    const result = await sendRequest({
      url: "http://kavita.lan:5000/api/annotations",
      method: "POST",
      body: "{}",
      contentType: "application/json",
    });

    expect(proxied).toEqual([]);
    expect(direct[0].url).toBe("http://kavita.lan:5000/api/annotations");
    expect(direct[0].headers).toEqual({ "Content-Type": "application/json" });
    expect(result.status).toBe(201);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(new TextDecoder().decode(result.body)).toBe("{}");
  });
});
