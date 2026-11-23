import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";

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
const BACKSTOP = 1000;

const servers = [];

async function start(backstop = settings.MAX_BODY_BACKSTOP) {
  const realBackstop = settings.MAX_BODY_BACKSTOP;
  settings.MAX_BODY_BACKSTOP = backstop;
  const app = express();
  app.use(bodyLimits());
  settings.MAX_BODY_BACKSTOP = realBackstop;
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

describe("the declared-length check", () => {
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
});

describe("the proxy JSON parser limit", () => {
  let base;

  beforeAll(async () => {
    base = await start(BACKSTOP);
  });

  it("allows the proxy an envelope over the backstop", async () => {
    const res = await postWithoutContentLength(base, "/api/proxy", {
      pad: "x".repeat(BACKSTOP * 10),
    });

    expect(res.status).toBe(200);
  });

  it("answers an envelope over the proxy parser limit with the readable 413", async () => {
    const res = await postWithoutContentLength(base, "/api/proxy", {
      pad: "x".repeat(BACKSTOP * 100),
    });

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual(PROXY_BODY_TOO_LARGE);
  });
});

describe("the proxy envelope size", () => {
  it("stops at the longest string the JSON parser can build", () => {
    expect(proxyEnvelopeBytes(settings.MAX_BODY_BACKSTOP)).toBe(
      constants.MAX_STRING_LENGTH,
    );
  });
});
