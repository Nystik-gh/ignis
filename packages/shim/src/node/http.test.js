import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Buffer } from "buffer/";
import { http, https } from "./http.js";
import { setDirectFetchHosts } from "../util/url.js";

const DIRECT = "http://hermes.lan:8642";
const LATE_EVENT_WAIT_MS = 40;

let calls;
let respond;

beforeEach(() => {
  calls = [];
  respond = () => proxyReply(200, {}, "");

  globalThis.window = {
    location: { origin: "https://ignis.test" },
    __originalFetch: async (url, opts) => {
      const call = { url, ...opts };

      if (url === "/api/proxy") {
        Object.assign(call, JSON.parse(opts.body));
      }

      calls.push(call);

      return respond(call);
    },
  };

  setDirectFetchHosts(["hermes.lan"]);
});

afterEach(() => {
  setDirectFetchHosts([]);
  delete globalThis.window;
  vi.restoreAllMocks();
});

function proxyReply(status, headers, body) {
  const preamble = Buffer.from(JSON.stringify({ status, headers }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(preamble.length);

  return new Response(Buffer.concat([length, preamble, Buffer.from(body)]));
}

function streamedReply(chunks, gapMs = 0, { signal, ...init } = {}) {
  let i = 0;
  const stream = new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () =>
        controller.error(new DOMException("aborted", "AbortError")),
      );
    },
    async pull(controller) {
      await new Promise((r) => setTimeout(r, gapMs));

      if (i < chunks.length) {
        const chunk = chunks[i++];
        controller.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
        );
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, init);
}

function neverReply(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

function record(emitter, prefix, log, events) {
  for (const event of events) {
    emitter.on(event, (arg) =>
      log.push(
        arg?.message ? `${prefix}${event}:${arg.message}` : `${prefix}${event}`,
      ),
    );
  }
}

function collect(req) {
  return new Promise((resolve) => {
    const log = [];
    const chunks = [];

    record(req, "req:", log, ["error", "timeout"]);
    req.on("response", (res) => {
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => log.push("res:end"));
      res.on("close", () => log.push("res:close"));
    });
    req.on("close", () => {
      log.push("req:close");
      setTimeout(
        () => resolve({ res: req.res, log, chunks }),
        LATE_EVENT_WAIT_MS,
      );
    });
  });
}

describe("a proxied request", () => {
  it("sends the method, headers and written body, and delivers the response", async () => {
    respond = () =>
      proxyReply(201, { "Content-Type": "application/json" }, '{"ok":true}');

    const payload = Buffer.from(JSON.stringify({ q: 1 }));
    const req = https.request("https://api.example.test/v1/runs?x=1", {
      method: "post",
      headers: {
        Authorization: "Bearer k",
        "Content-Length": String(payload.length),
        Accept: ["text/event-stream", "application/json"],
      },
    });
    const done = collect(req);
    let finished = false;

    req.write(payload.subarray(0, 3));
    req.write(payload.subarray(3));
    req.end(() => (finished = true));

    const { res, log, chunks } = await done;
    const sent = calls[0];

    expect(sent.url).toBe("https://api.example.test/v1/runs?x=1");
    expect(sent.method).toBe("POST");
    expect(sent.headers).toEqual({
      Authorization: "Bearer k",
      "Content-Length": String(payload.length),
      Accept: "text/event-stream, application/json",
    });
    expect(Buffer.from(sent.body, "base64").toString()).toBe('{"q":1}');
    expect(finished).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(res.statusMessage).toBe("Created");
    expect(res.headers).toEqual({ "content-type": "application/json" });
    expect(chunks).toHaveLength(1);
    expect(Buffer.isBuffer(chunks[0])).toBe(true);
    expect(chunks[0].toString()).toBe('{"ok":true}');
    expect(log).toEqual(["res:end", "req:close", "res:close"]);
    expect(req.destroyed).toBe(true);
    expect(res.destroyed).toBe(true);
  });

  it("emits a transport failure as an error with its code, then close", async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          error: "Upstream timed out",
          code: "upstream-timeout",
        }),
        { status: 504 },
      );

    let error;
    const req = http.get("http://api.example.test/");
    req.on("error", (e) => (error = e));
    const { log } = await collect(req);

    expect(error.code).toBe("upstream-timeout");
    expect(log).toEqual(["req:error:Upstream timed out", "req:close"]);
  });

  it("logs an error nobody listens for instead of throwing", async () => {
    respond = () => new Response("{}", { status: 502 });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await new Promise((resolve) => {
      http.get("http://api.example.test/").on("close", resolve);
    });

    expect(logged).toHaveBeenCalledOnce();
  });

  it("sends no body when nothing, or nothing but empty chunks, was written", async () => {
    respond = () => new Response(null, { status: 204 });

    await collect(http.get(`${DIRECT}/`));
    const req = http.request(`${DIRECT}/`);
    req.write(Buffer.alloc(0));
    req.end("");
    await collect(req);

    expect(calls.map((c) => c.body)).toEqual([undefined, undefined]);
  });
});

describe("the address a request goes to", () => {
  it("defaults each module's protocol and port in the options form", async () => {
    http.request({ hostname: "api.example.test", path: "/a?b=1" }).end();
    https.request({ host: "api.example.test", port: 8443, path: "/c" }).end();
    http.request({ hostname: "::1", port: 9, path: "/d" }).end();
    await vi.waitFor(() => expect(calls).toHaveLength(3));

    expect(calls.map((c) => c.url)).toEqual([
      "http://api.example.test/a?b=1",
      "https://api.example.test:8443/c",
      "http://[::1]:9/d",
    ]);
  });

  it("refuses a URL for the other module's protocol", () => {
    expect(() => http.request("https://api.example.test/")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_PROTOCOL" }),
    );
  });

  it("sends URL credentials and the auth option as Basic authorization", async () => {
    const basic = (auth) => `Basic ${Buffer.from(auth).toString("base64")}`;

    http.get("http://u%40x:p@api.example.test/a");
    http.get("http://:pw@api.example.test/b");
    http.get({ hostname: "api.example.test", auth: "v:q" });
    http.get({
      hostname: "api.example.test",
      auth: "v:q",
      headers: { authorization: "Bearer k" },
    });
    await vi.waitFor(() => expect(calls).toHaveLength(4));

    expect(calls[0].url).toBe("http://api.example.test/a");
    expect(calls.map((c) => c.headers)).toEqual([
      { Authorization: basic("u@x:p") },
      { Authorization: basic(":pw") },
      { Authorization: basic("v:q") },
      { authorization: "Bearer k" },
    ]);
  });
});

describe("destroying a request", () => {
  it("before the response emits the given error, then close, and aborts the transport", async () => {
    respond = (call) => neverReply(call.signal);

    const req = http.get("http://api.example.test/");
    const done = collect(req);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    req.destroy(new Error("request timed out"));

    expect((await done).log).toEqual([
      "req:error:request timed out",
      "req:close",
    ]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("through abort() emits abort, then socket hang up, then close", async () => {
    respond = (call) => neverReply(call.signal);

    let error;
    const req = http.get("http://api.example.test/");
    req.on("error", (e) => (error = e));
    const log = [];
    record(req, "req:", log, ["abort"]);
    const done = collect(req);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    req.abort();
    req.abort();
    log.push(...(await done).log);

    expect(log).toEqual(["req:abort", "req:error:socket hang up", "req:close"]);
    expect(error.code).toBe("ECONNRESET");
  });

  it("mid-body aborts the response in Node's order and releases the host", async () => {
    respond = (call) =>
      streamedReply(["a", "b", "c"], 30, { signal: call.signal });

    const log = [];
    const req = http.get(`${DIRECT}/`);
    record(req, "req:", log, ["error", "close"]);

    await new Promise((resolve) => {
      req.on("response", (res) => {
        record(res, "res:", log, ["aborted", "error", "close", "end"]);
        res.on("data", () => {
          req.destroy();
        });
        res.on("close", resolve);
      });
    });

    expect(log).toEqual([
      "res:aborted",
      "req:close",
      "res:error:aborted",
      "res:close",
    ]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("mid-body with an error, while a read is pending, emits it on the request before the response aborts", async () => {
    respond = (call) =>
      streamedReply(["a", "b", "c"], 50, { signal: call.signal });

    const log = [];
    const req = http.get(`${DIRECT}/`);
    record(req, "req:", log, ["error", "close"]);

    await new Promise((resolve) => {
      req.on("response", (res) => {
        record(res, "res:", log, ["aborted", "close"]);
        res.once("data", () => {
          setTimeout(() => req.destroy(new Error("stopped")), 10);
        });
        res.on("close", resolve);
      });
    });

    expect(log).toEqual([
      "req:error:stopped",
      "res:aborted",
      "req:close",
      "res:close",
    ]);
  });

  it("through the signal option emits an AbortError", async () => {
    respond = (call) => neverReply(call.signal);

    const controller = new AbortController();
    let error;
    const req = http.get("http://api.example.test/", {
      signal: controller.signal,
    });
    req.on("error", (e) => (error = e));
    const done = collect(req);
    controller.abort();
    await done;

    expect(error.name).toBe("AbortError");
    expect(error.code).toBe("ABORT_ERR");
  });

  it("through an already aborted signal emits an AbortError without sending", async () => {
    let error;
    const req = http.get("http://api.example.test/", {
      signal: AbortSignal.abort(),
    });
    req.on("error", (e) => (error = e));
    await collect(req);

    expect(error.name).toBe("AbortError");
    expect(calls).toEqual([]);
  });

  it("after it completed does nothing, through destroy or its signal", async () => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const req = http.get("http://api.example.test/", {
      signal: controller.signal,
    });
    const done = collect(req);
    await new Promise((resolve) => req.on("close", resolve));

    controller.abort();
    req.destroy(new Error("late"));

    expect((await done).log).toEqual(["res:end", "req:close", "res:close"]);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("the timeout option", () => {
  it("emits timeout when nothing arrives in time, without ending the request", async () => {
    respond = (call) => neverReply(call.signal);

    const req = http.get("http://api.example.test/", { timeout: 20 });
    const done = collect(req);
    await new Promise((resolve) => req.on("timeout", resolve));

    expect(req.destroyed).toBe(false);
    req.destroy(new Error("request timed out"));

    expect((await done).log).toEqual([
      "req:timeout",
      "req:error:request timed out",
      "req:close",
    ]);
  });

  it("restarts on each chunk the host sends", async () => {
    respond = () => streamedReply(["a", "b", "c", "d"], 25);

    const { log, chunks } = await collect(
      http.get(`${DIRECT}/`, { timeout: 60 }),
    );

    expect(chunks).toHaveLength(4);
    expect(log).not.toContain("req:timeout");
  });

  it("set once the response has arrived still fires", async () => {
    respond = (call) => streamedReply(["a", "b"], 100, { signal: call.signal });

    const req = http.get(`${DIRECT}/`, (res) => {
      req.setTimeout(20);
      res.on("data", () => {});
    });
    const done = collect(req);
    req.on("timeout", () => req.destroy());

    expect((await done).log[0]).toBe("req:timeout");
  });

  it("stops when the request completes", async () => {
    const { log } = await collect(
      http.get("http://api.example.test/", { timeout: 20 }),
    );

    expect(log).toEqual(["res:end", "req:close", "res:close"]);
  });
});

describe("writing to a request", () => {
  it("after end emits a write-after-end error", async () => {
    const req = http.request("http://api.example.test/", { method: "POST" });
    let error;
    req.on("error", (e) => (error = e));
    req.end();
    req.write("late");
    await vi.waitFor(() => expect(error).toBeDefined());

    expect(error.code).toBe("ERR_STREAM_WRITE_AFTER_END");
  });
});
