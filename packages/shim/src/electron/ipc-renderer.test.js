import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ipcRenderer } from "./ipc-renderer.js";

let proxied;

beforeEach(() => {
  proxied = [];

  globalThis.window = {
    location: { origin: "https://ignis.test" },
    __originalFetch: async (url, opts) => {
      proxied.push(JSON.parse(opts.body));

      return {
        ok: true,
        json: async () => ({ status: 200, headers: {}, body: "" }),
      };
    },
  };
});

afterEach(() => {
  delete globalThis.window;
  vi.restoreAllMocks();
});

function requestUrl(request) {
  return new Promise((resolve) => {
    ipcRenderer.once("req-1", (event, reply) => resolve(reply));
    ipcRenderer.send("request-url", "req-1", request);
  });
}

describe("a requestUrl call through IPC", () => {
  it("sends its contentType as a Content-Type header", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await requestUrl({
      url: "https://api.example.test/annotations",
      method: "POST",
      contentType: "application/json",
      body: "{}",
    });

    expect(proxied[0].headers).toEqual({
      "Content-Type": "application/json",
      "user-agent": expect.any(String),
    });
  });
});

describe("a failed requestUrl call through IPC", () => {
  it("replies with the proxy's Error and code", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    window.__originalFetch = async () => ({
      ok: false,
      json: async () => ({
        error: "Upstream connection failed (ECONNREFUSED)",
        code: "ECONNREFUSED",
      }),
    });

    const reply = await requestUrl({ url: "https://api.example.test/item" });

    expect(reply.error).toBeInstanceOf(Error);
    expect(reply.error.message).toBe(
      "Upstream connection failed (ECONNREFUSED)",
    );
    expect(reply.error.code).toBe("ECONNREFUSED");
  });
});

describe("the request-url log line", () => {
  it("names the channel without the request's headers or body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await requestUrl({
      url: "https://api.example.test/login",
      method: "POST",
      headers: { Authorization: "Bearer SECRET" },
      body: '{"password":"SECRET"}',
    });

    expect(log).toHaveBeenCalledWith("[shim:ipcRenderer] send:", "request-url");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
});

describe("the policy answer", () => {
  it("carries the same values flat and under policy", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const answer = ipcRenderer.sendSync("policy");
    const sharedKeys = ["plugins", "themes", "snippets", "devTools", "insider"];

    for (const key of sharedKeys) {
      expect(answer[key]).toBe(true);
      expect(answer.policy[key]).toBe(answer[key]);
    }
  });
});

describe("the plugin-script-root channel", () => {
  it("answers null without the unhandled-channel warning", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(ipcRenderer.sendSync("plugin-script-root")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the adblock channels", () => {
  it("answer Obsidian's defaults and keep values sent to them", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(ipcRenderer.sendSync("adblock-lists")).toEqual([
      "https://easylist.to/easylist/easylist.txt",
      "https://easylist.to/easylist/easyprivacy.txt",
    ]);
    expect(ipcRenderer.sendSync("adblock-frequency")).toBe(4);

    ipcRenderer.sendSync("adblock-lists", ["https://lists.example.test/a.txt"]);
    ipcRenderer.sendSync("adblock-frequency", 12);

    expect(ipcRenderer.sendSync("adblock-lists")).toEqual([
      "https://lists.example.test/a.txt",
    ]);
    expect(ipcRenderer.sendSync("adblock-frequency")).toBe(12);
  });
});
