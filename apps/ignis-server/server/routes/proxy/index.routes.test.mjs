import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";

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
