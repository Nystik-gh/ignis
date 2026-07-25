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
const settings = require("../settings");
const proxyRouter = require("./proxy");
const express = require("express");

const realLookup = dns.promises.lookup;

let server;
let base;
let upstream;
let upstreamBase;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/proxy", proxyRouter);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  base = `http://127.0.0.1:${server.address().port}`;

  // Upstream for the redirect-hop test.
  upstream = http.createServer((req, res) => {
    res.writeHead(302, { Location: "http://10.9.9.9/blocked" });
    res.end();
  });

  await new Promise((resolve) => {
    upstream.listen(0, resolve);
  });

  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
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
  settings.update({ proxyMode: "any", proxyAllowlist: [] });
});

const proxy = (url) =>
  fetch(`${base}/api/proxy/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });

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
