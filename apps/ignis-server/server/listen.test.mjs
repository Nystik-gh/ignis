import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);
const { listen, cleanup } = require("./listen.js");

// Express-shaped stand-in: app.listen(target, cb) delegating to a plain http server.
function makeApp() {
  return {
    listen: (target, cb) =>
      http
        .createServer((req, res) => {
          res.end("ok");
        })
        .listen(target, cb),
  };
}

function requestOverSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: "/" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Unix domain sockets are unavailable on Windows; skip those cases where binding fails.
let canBindSocket = false;
try {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-socket-probe-"));
  const probePath = path.join(probeDir, "probe.sock");
  const srv = http.createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(probePath, resolve);
  });
  canBindSocket = true;
  await new Promise((resolve) => srv.close(resolve));
  fs.rmSync(probeDir, { recursive: true, force: true });
} catch {
  canBindSocket = false;
}

function tmpSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-listen-test-"));
  return path.join(dir, "server.sock");
}

describe("listen", () => {
  it("listens on a TCP port when socketPath is unset", async () => {
    const server = listen(makeApp(), { socketPath: null, port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    expect(server.address().port).toBeGreaterThan(0);
    await closeServer(server);
  });

  it.skipIf(!canBindSocket)("listens on a unix socket and serves requests", async () => {
    const socketPath = tmpSocketPath();
    const server = listen(makeApp(), { socketPath, port: 8080 });
    await new Promise((resolve) => server.once("listening", resolve));

    const res = await requestOverSocket(socketPath);
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");

    await closeServer(server);
  });

  it.skipIf(!canBindSocket)("makes the socket connectable by other users (0666)", async () => {
    const socketPath = tmpSocketPath();
    const server = listen(makeApp(), { socketPath, port: 8080 });
    await new Promise((resolve) => server.once("listening", resolve));

    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o666);

    await closeServer(server);
  });

  it.skipIf(!canBindSocket)("removes a stale socket file before binding", async () => {
    const socketPath = tmpSocketPath();
    fs.writeFileSync(socketPath, ""); // leftover from an unclean shutdown

    const server = listen(makeApp(), { socketPath, port: 8080 });
    await new Promise((resolve) => server.once("listening", resolve));

    const res = await requestOverSocket(socketPath);
    expect(res.status).toBe(200);

    await closeServer(server);
  });

  it.skipIf(!canBindSocket)("cleanup removes the socket file", async () => {
    const socketPath = tmpSocketPath();
    const server = listen(makeApp(), { socketPath, port: 8080 });
    await new Promise((resolve) => server.once("listening", resolve));
    await closeServer(server);

    cleanup({ socketPath });
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it("cleanup is a no-op without socketPath", () => {
    expect(() => cleanup({ socketPath: null })).not.toThrow();
  });
});
