import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import net from "net";
import zlib from "zlib";

const require = createRequire(import.meta.url);

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "body-limits-test-"));
process.env.DATA_ROOT = DATA_ROOT;

const express = require("express");
const settings = require("./settings");
const { constants } = require("buffer");
const {
  bodyLimits,
  proxyEnvelopeBytes,
  PROXY_BODY_TOO_LARGE,
} = require("./body-limits");

const MAX = 300 * 1024;

const servers = [];

async function start() {
  const app = express();
  app.use(bodyLimits());
  app.post("/api/proxy", (req, res) => res.json({}));
  app.post("/api/other", (req, res) => res.json({}));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  servers.push(server);

  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, route, payload) {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function postWithoutContentLength(base, route, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${route}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );

    req.on("error", reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

beforeEach(() => {
  settings.update({ maxBodyBytes: MAX });
});

afterAll(() => {
  for (const server of servers) {
    server.close();
  }

  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("a body with a declared size", () => {
  let base;

  beforeAll(async () => {
    base = await start();
  });

  it("answers a proxy envelope over the allowance with the readable 413", async () => {
    const res = await post(base, "/api/proxy", { pad: "x".repeat(MAX * 2) });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(PROXY_BODY_TOO_LARGE);
  });

  it("keeps the plain 413 on other routes", async () => {
    const res = await post(base, "/api/other", { pad: "x".repeat(MAX + 1) });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body too large" });
  });

  it("answers before the oversized body has been sent", async () => {
    const statusLine = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(new URL(base).port), "127.0.0.1");
      let received = "";

      socket.on("connect", () => {
        socket.write(
          "POST /api/proxy HTTP/1.1\r\nHost: 127.0.0.1\r\n" +
            "Content-Type: application/json\r\n" +
            `Content-Length: ${MAX * 10}\r\n\r\n{"pad":"`,
        );
      });
      socket.on("data", (chunk) => {
        received += chunk;
        resolve(received.split("\r\n")[0]);
        socket.destroy();
      });
      socket.on("error", reject);
    });

    expect(statusLine).toContain(" 413 ");
  });

  it("refuses an oversized body that is not JSON", async () => {
    const res = await fetch(`${base}/api/other`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(MAX + 1),
    });

    expect(res.status).toBe(413);
  });
});

describe("a body without a declared size", () => {
  let base;

  beforeAll(async () => {
    base = await start();
  });

  it("lets a proxy envelope between the setting and the allowance through", async () => {
    const res = await postWithoutContentLength(base, "/api/proxy", {
      pad: "x".repeat(MAX * 1.2),
    });

    expect(res.status).toBe(200);
  });

  it("answers a proxy envelope over the allowance with the readable 413", async () => {
    const res = await postWithoutContentLength(base, "/api/proxy", {
      pad: "x".repeat(MAX * 2),
    });

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual(PROXY_BODY_TOO_LARGE);
  });

  it("answers another route's body over the setting with the plain 413", async () => {
    const res = await postWithoutContentLength(base, "/api/other", {
      pad: "x".repeat(MAX + 1),
    });

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: "Request body too large" });
  });

  it("follows a change to the setting without a restart", async () => {
    const payload = { pad: "x".repeat(MAX + 1) };

    expect(
      (await postWithoutContentLength(base, "/api/other", payload)).status,
    ).toBe(413);

    settings.update({ maxBodyBytes: MAX * 2 });

    expect(
      (await postWithoutContentLength(base, "/api/other", payload)).status,
    ).toBe(200);
  });

  it("never reads past the backstop, whatever the setting", async () => {
    const realBackstop = settings.MAX_BODY_BACKSTOP;
    settings.MAX_BODY_BACKSTOP = 1000;

    try {
      const res = await postWithoutContentLength(base, "/api/other", {
        pad: "x".repeat(2000),
      });

      expect(res.status).toBe(413);
    } finally {
      settings.MAX_BODY_BACKSTOP = realBackstop;
    }
  });
});

describe("a compressed body", () => {
  let base;

  beforeAll(async () => {
    base = await start();
  });

  it("answers a proxy body that inflates past the allowance with the readable 413", async () => {
    const compressed = zlib.gzipSync(
      JSON.stringify({ pad: "x".repeat(MAX * 2) }),
    );
    const res = await fetch(`${base}/api/proxy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressed,
    });

    expect(compressed.length).toBeLessThan(MAX);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(PROXY_BODY_TOO_LARGE);
  });
});

describe("the proxy envelope size", () => {
  it("stops at the longest string the JSON parser can build", () => {
    expect(proxyEnvelopeBytes(settings.MAX_BODY_BACKSTOP)).toBe(
      constants.MAX_STRING_LENGTH,
    );
  });
});
