import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import zlib from "zlib";

const require = createRequire(import.meta.url);

// use temp dir for testing.
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-route-test-"));
process.env.DATA_ROOT = DATA_ROOT;
// Read at module load; lets the redirect-hop test reach its local upstream.
process.env.PROXY_ALLOW_PRIVATE_HOSTS = "127.0.0.1";

const dns = require("dns");
const settings = require("../../settings");
const proxyRouter = require("./index");
const { bodyLimits } = require("../../body-limits");
const express = require("express");
const compression = require("compression");

const realLookup = dns.promises.lookup;

let server;
let base;
let upstream;
let upstreamBase;
let refusedBase;
let onHangingRequest;

beforeAll(async () => {
  const app = express();
  app.use(bodyLimits());
  app.use(compression());
  app.use("/api/proxy", proxyRouter);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  base = `http://127.0.0.1:${server.address().port}`;

  upstream = http.createServer((req, res) => {
    if (req.url === "/hang") {
      onHangingRequest(req);
      return;
    }

    if (req.url === "/slow") {
      setTimeout(() => res.end("done"), 200);
      return;
    }

    if (req.url === "/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: second\n\n"), 300);
      return;
    }

    if (req.url === "/unsized") {
      const block = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      res.writeHead(200);

      const pump = () => {
        while (sent < UNSIZED_MB) {
          sent++;

          if (!res.write(block)) {
            res.once("drain", pump);
            return;
          }
        }

        res.end();
      };

      pump();
      return;
    }

    if (req.url === "/gzip" || req.url === "/br") {
      const encoding = req.url.slice(1);
      const encoded =
        encoding === "gzip"
          ? zlib.gzipSync("hello gzip")
          : zlib.brotliCompressSync("hello br");

      res.writeHead(200, {
        "Content-Encoding": encoding,
        "Content-Length": encoded.length,
      });
      res.end(encoded);
      return;
    }

    if (req.url === "/reset") {
      res.writeHead(200);
      res.write("partial", () => setTimeout(() => res.socket.destroy(), 50));
      return;
    }

    if (req.url === "/gzip-204" || req.url === "/gzip-304") {
      res.writeHead(Number(req.url.slice(-3)), { "Content-Encoding": "gzip" });
      res.end();
      return;
    }

    if (req.url === "/headers") {
      res.writeHead(200, {
        "Set-Cookie": "sid=upstream; Path=/",
        "X-Owner": "café",
      });
      res.end("after the headers");
      return;
    }

    if (req.url === "/first-chunk-then-hang") {
      res.writeHead(200);
      res.write("a");
      onHangingRequest(req);
      return;
    }

    if (req.url === "/upload") {
      req.resume();
      req.on("end", () => res.end());
      return;
    }

    res.writeHead(302, { Location: "http://10.9.9.9/blocked" });
    res.end();
  });

  await new Promise((resolve) => {
    upstream.listen(0, resolve);
  });

  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;

  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, resolve));
  refusedBase = `http://127.0.0.1:${closed.address().port}`;
  await new Promise((resolve) => closed.close(resolve));
});

afterAll(() => {
  if (server) {
    server.close();
  }

  if (upstream) {
    upstream.close();
  }

  dns.promises.lookup = realLookup;
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  dns.promises.lookup = realLookup;
  settings.update({
    proxyMode: "any",
    proxyAllowlist: [],
    maxBodyBytes: settings.DEFAULTS.maxBodyBytes,
  });
});

const post = (route, payload) =>
  fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const proxy = (url) => post("/api/proxy/", { url });

const UNSIZED_MB = 60;

async function readStream(res, { keepBody = true } = {}) {
  const start = Date.now();
  const reader = res.body.getReader();
  let pending = Buffer.alloc(0);
  let preamble = null;
  const chunks = [];
  let bodyBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    let bytes = Buffer.from(value);

    if (!preamble) {
      pending = Buffer.concat([pending, bytes]);

      if (pending.length < 4 || pending.length < 4 + pending.readUInt32BE(0)) {
        continue;
      }

      const length = pending.readUInt32BE(0);
      preamble = JSON.parse(pending.subarray(4, 4 + length).toString());
      bytes = pending.subarray(4 + length);
    }

    if (bytes.length > 0) {
      bodyBytes += bytes.length;

      if (keepBody) {
        chunks.push({ at: Date.now() - start, text: bytes.toString() });
      }
    }
  }

  return { preamble, chunks, bodyBytes };
}

const streamProxy = (url, extra = {}) =>
  post("/api/proxy/", { url, stream: true, ...extra });

describe("proxy guard responses", () => {
  it("rejects a private IP literal with a private-host block body", async () => {
    const res = await proxy("http://10.9.9.9/test");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("private-host");
    expect(body.host).toBe("10.9.9.9");
    expect(body.error).toBeTruthy();
  });

  it("rejects a hostname resolving privately with a private-resolve block body", async () => {
    dns.promises.lookup = async () => [{ address: "192.168.5.5", family: 4 }];

    const res = await proxy("http://backend.internal/api");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("private-resolve");
    expect(body.host).toBe("backend.internal");
    expect(body.address).toBe("192.168.5.5");
  });

  it("rejects an unresolvable hostname with a dns block body", async () => {
    dns.promises.lookup = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      });
    };

    const res = await proxy("http://no-such-host.invalid/x");
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("dns");
    expect(body.host).toBe("no-such-host.invalid");
  });

  it("rejects when proxy access is disabled with a disabled block body", async () => {
    settings.update({ proxyMode: "disabled" });

    const res = await proxy("http://example.com/x");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("disabled");
  });

  it("rejects a host missing from the allowlist with an allowlist block body", async () => {
    settings.update({
      proxyMode: "allowlist",
      proxyAllowlist: ["api.github.com"],
    });
    // The pre-flight guard resolves the host before the allowlist check runs.
    dns.promises.lookup = async () => [{ address: "93.184.216.34", family: 4 }];

    const res = await proxy("http://other.example.com/x");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("allowlist");
    expect(body.host).toBe("other.example.com");
  });

  it("keeps the block body when the block happens on a redirect hop", async () => {
    const res = await proxy(`${upstreamBase}/`);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("private-host");
    expect(body.host).toBe("10.9.9.9");
  });

  it("rejects a missing url without a block code", async () => {
    const res = await proxy(undefined);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBeUndefined();
  });
});

describe("relay error responses", () => {
  it("returns an exposed relay error's message and code", async () => {
    const res = await proxy(`${refusedBase}/`);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Upstream connection failed (ECONNREFUSED)",
      code: "ECONNREFUSED",
    });
  });

  it("keeps the sanitized shape for any other error", async () => {
    const res = await post("/api/proxy", {
      url: `${upstreamBase}/upload`,
      method: "NOT A TOKEN",
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "ERR_INVALID_HTTP_TOKEN",
      code: "ERR_INVALID_HTTP_TOKEN",
    });
  });
});

describe("the proxy upload limit", () => {
  const MAX = 300 * 1024;
  const TOO_LARGE = {
    error:
      "Request body too large (Max request body in Settings > Ignis > General > Security)",
    code: "body-too-large",
  };

  const upload = (bytes) =>
    post("/api/proxy", {
      url: `${upstreamBase}/upload`,
      method: "PUT",
      body: Buffer.alloc(bytes, 7).toString("base64"),
      binary: true,
    });

  beforeEach(() => {
    settings.update({ maxBodyBytes: MAX });
  });

  it("passes a binary upload of exactly Max request body", async () => {
    const res = await upload(MAX);

    expect(res.status).toBe(200);
  });

  it("answers one byte more with the readable 413", async () => {
    const res = await upload(MAX + 1);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(TOO_LARGE);
  });
});

describe("a client that waits for its proxy call", () => {
  it("gets the upstream response", async () => {
    const res = await proxy(`${upstreamBase}/slow`);
    const relayed = await res.json();

    expect(res.status).toBe(200);
    expect(Buffer.from(relayed.body, "base64").toString()).toBe("done");
  });
});

describe("a client that aborts its proxy call", () => {
  it("closes the upstream connection", async () => {
    const abort = new AbortController();
    const arrived = new Promise((resolve) => {
      onHangingRequest = resolve;
    });
    const call = fetch(`${base}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${upstreamBase}/hang` }),
      signal: abort.signal,
    });

    const upstreamRequest = await arrived;
    const closed = new Promise((resolve) =>
      upstreamRequest.socket.on("close", resolve),
    );
    abort.abort();

    await expect(call).rejects.toThrow();
    await closed;
  });
});

describe("the stream mode", () => {
  it("answers a guard refusal exactly as the envelope does", async () => {
    const envelope = await proxy("http://10.9.9.9/x");
    const streamed = await streamProxy("http://10.9.9.9/x");

    expect(streamed.status).toBe(envelope.status);
    expect(await streamed.json()).toEqual(await envelope.json());
  });

  it("delivers each upstream chunk as it arrives, under its own response headers", async () => {
    const res = await streamProxy(`${upstreamBase}/sse`);
    const { preamble, chunks } = await readStream(res);

    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(preamble.status).toBe(200);
    expect(preamble.headers["content-type"]).toBe("text/event-stream");
    expect(chunks.map((c) => c.text)).toEqual([
      "data: first\n\n",
      "data: second\n\n",
    ]);
    expect(chunks[0].at).toBeLessThan(200);
    expect(chunks[1].at).toBeGreaterThanOrEqual(250);
  });

  it("carries a body past the envelope's cap with no declared length", async () => {
    const streamed = await readStream(
      await streamProxy(`${upstreamBase}/unsized`),
      {
        keepBody: false,
      },
    );
    const envelope = await proxy(`${upstreamBase}/unsized`);

    expect(streamed.bodyBytes).toBe(UNSIZED_MB * 1024 * 1024);
    expect(envelope.status).toBe(413);
    expect((await envelope.json()).code).toBe("upstream-too-large");
  });

  it("decodes gzip and br bodies and drops their encoding headers", async () => {
    for (const encoding of ["gzip", "br"]) {
      const { preamble, chunks } = await readStream(
        await streamProxy(`${upstreamBase}/${encoding}`),
      );

      expect(chunks.map((c) => c.text).join("")).toBe(`hello ${encoding}`);
      expect(preamble.headers["content-encoding"]).toBeUndefined();
      expect(preamble.headers["content-length"]).toBeUndefined();
    }
  });

  it("breaks off the response when the upstream fails midway", async () => {
    const res = await streamProxy(`${upstreamBase}/reset`);

    await expect(readStream(res)).rejects.toThrow();
  });

  it("gives a bodiless response its preamble and nothing else, whatever encoding it names", async () => {
    const cases = [
      ["HEAD", "/gzip", 200],
      ["GET", "/gzip-204", 204],
      ["GET", "/gzip-304", 304],
    ];

    for (const [method, route, status] of cases) {
      const streamed = await readStream(
        await streamProxy(`${upstreamBase}${route}`, { method }),
      );
      const envelope = await post("/api/proxy/", {
        url: `${upstreamBase}${route}`,
        method,
      });

      expect([route, streamed.preamble.status, streamed.bodyBytes]).toEqual([
        route,
        status,
        0,
      ]);
      expect([route, (await envelope.json()).status]).toEqual([route, status]);
    }
  });

  it("keeps upstream headers inside the preamble, whatever characters they hold", async () => {
    const res = await streamProxy(`${upstreamBase}/headers`);
    const { preamble, chunks } = await readStream(res);

    expect(res.headers.get("set-cookie")).toBeNull();
    expect(preamble.headers["set-cookie"]).toEqual(["sid=upstream; Path=/"]);
    expect(preamble.headers["x-owner"]).toBe("café");
    expect(chunks.map((c) => c.text).join("")).toBe("after the headers");
  });

  it("closes the upstream connection when the client disconnects mid-stream", async () => {
    const abort = new AbortController();
    const arrived = new Promise((resolve) => {
      onHangingRequest = resolve;
    });
    const res = await fetch(`${base}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${upstreamBase}/first-chunk-then-hang`,
        stream: true,
      }),
      signal: abort.signal,
    });

    expect(res.status).toBe(200);

    const upstreamRequest = await arrived;
    const closed = new Promise((resolve) =>
      upstreamRequest.socket.on("close", resolve),
    );
    abort.abort();

    await closed;
  });
});
