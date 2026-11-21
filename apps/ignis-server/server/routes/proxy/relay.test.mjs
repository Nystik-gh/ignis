import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import http from "node:http";

const require = createRequire(import.meta.url);

process.env.PROXY_ALLOW_PRIVATE_HOSTS = "127.0.0.1";

const {
  proxyRequest,
  requestOnce,
  stripRequestFramingHeaders,
} = require("./relay.js");

describe("stripRequestFramingHeaders", () => {
  it("drops content-length and transfer-encoding case-insensitively", () => {
    const out = stripRequestFramingHeaders({
      "Content-Length": "5",
      "transfer-encoding": "chunked",
      "Content-Type": "text/plain",
      Authorization: "Bearer x",
    });

    expect(out).toEqual({
      "Content-Type": "text/plain",
      Authorization: "Bearer x",
    });
  });

  it("leaves headers untouched when no framing headers are present", () => {
    const headers = { "Content-Type": "application/json", "X-Custom": "1" };

    expect(stripRequestFramingHeaders(headers)).toEqual(headers);
  });
});

describe("requestOnce framing", () => {
  function startEcho() {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              declaredCL: req.headers["content-length"] ?? null,
              transferEncoding: req.headers["transfer-encoding"] ?? null,
              authorization: req.headers["authorization"] ?? null,
              bytesRead: buf.length,
              body: buf.toString("utf8"),
            }),
          );
        });
      });

      srv.listen(0, "127.0.0.1", () => resolve(srv));
    });
  }

  function readJson(res) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  it("writes the whole body despite a too-short caller Content-Length", async () => {
    const srv = await startEcho();

    try {
      const { port } = srv.address();
      const url = new URL(`http://127.0.0.1:${port}/`);
      const body = "héllo wörld \u{1F600}"; // 18 utf8 bytes, 14 string chars

      const res = await requestOnce(
        url,
        "PUT",
        { "Content-Length": String(body.length), "X-Keep": "1" },
        body,
      );

      const echoed = await readJson(res);

      expect(echoed.bytesRead).toBe(Buffer.byteLength(body, "utf8"));
      expect(echoed.body).toBe(body);
      expect(Number(echoed.declaredCL)).toBe(Buffer.byteLength(body, "utf8"));
      expect(echoed.transferEncoding).toBe(null);
    } finally {
      srv.close();
    }
  });

  it("preserves non-framing headers while replacing Content-Length", async () => {
    const srv = await startEcho();

    try {
      const { port } = srv.address();
      const url = new URL(`http://127.0.0.1:${port}/`);
      const body = Buffer.from([1, 2, 3, 4, 5, 6, 7]);

      const res = await requestOnce(
        url,
        "PUT",
        { "Content-Length": "999", Authorization: "Bearer tok" },
        body,
      );

      const echoed = await readJson(res);

      expect(echoed.bytesRead).toBe(body.length);
      expect(Number(echoed.declaredCL)).toBe(body.length);
      expect(echoed.transferEncoding).toBe(null);
      expect(echoed.authorization).toBe("Bearer tok");
    } finally {
      srv.close();
    }
  });
});

describe("a redirected request", () => {
  const SENT_HEADERS = {
    "Content-Type": "text/plain",
    "content-encoding": "identity",
    "Content-Language": "sv",
    "Content-Location": "/draft",
    Authorization: "Bearer tok",
    Cookie: "c=1",
  };

  let target;
  let elsewhere;

  function startServer(redirectOrigin = "") {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        const redirect = req.url.match(/^\/redirect\/(\d+)$/);

        if (redirect) {
          res.writeHead(Number(redirect[1]), {
            Location: `${redirectOrigin}/target`,
          });
          res.end();
          return;
        }

        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const arrived = {
            method: req.method,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: req.headers["content-type"] ?? null,
            contentEncoding: req.headers["content-encoding"] ?? null,
            contentLanguage: req.headers["content-language"] ?? null,
            contentLocation: req.headers["content-location"] ?? null,
            authorization: req.headers["authorization"] ?? null,
            cookie: req.headers["cookie"] ?? null,
          };

          res.writeHead(200, { "X-Arrived": JSON.stringify(arrived) });
          res.end();
        });
      });

      srv.listen(0, "127.0.0.1", () => resolve(srv));
    });
  }

  const origin = (srv) => `http://127.0.0.1:${srv.address().port}`;

  beforeAll(async () => {
    target = await startServer();
    elsewhere = await startServer(origin(target));
  });

  afterAll(() => {
    target.close();
    elsewhere.close();
  });

  async function arrival(status, method, from = target) {
    const res = await proxyRequest({
      url: `${origin(from)}/redirect/${status}`,
      method,
      headers: SENT_HEADERS,
      body: "payload",
    });

    res.resume();

    return JSON.parse(res.headers["x-arrived"]);
  }

  const kept = {
    contentType: "text/plain",
    contentEncoding: "identity",
    contentLanguage: "sv",
    contentLocation: "/draft",
    authorization: "Bearer tok",
    cookie: "c=1",
  };

  it.each([
    [301, "PUT"],
    [302, "DELETE"],
    [307, "POST"],
    [308, "POST"],
  ])("keeps the method and body on a %i after a %s", async (status, method) => {
    expect(await arrival(status, method)).toEqual({
      method,
      body: "payload",
      ...kept,
    });
  });

  it("keeps a HEAD on a 303", async () => {
    expect(await arrival(303, "HEAD")).toEqual({
      method: "HEAD",
      body: "",
      ...kept,
    });
  });

  it.each([
    [301, "POST"],
    [302, "POST"],
    [302, "post"],
    [303, "PUT"],
  ])(
    "arrives as a GET without body headers on a %i after a %s",
    async (status, method) => {
      expect(await arrival(status, method)).toEqual({
        method: "GET",
        body: "",
        contentType: null,
        contentEncoding: null,
        contentLanguage: null,
        contentLocation: null,
        authorization: "Bearer tok",
        cookie: "c=1",
      });
    },
  );

  it("drops Authorization and Cookie when the redirect leaves the origin", async () => {
    const arrived = await arrival(307, "POST", elsewhere);

    expect(arrived.authorization).toBeNull();
    expect(arrived.cookie).toBeNull();
    expect(arrived.body).toBe("payload");
  });
});
