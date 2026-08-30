import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vault-route-test-"));
process.env.VAULT_ROOT = VAULT_ROOT;
const VAULT_ID = "v";
const vaultDir = path.join(VAULT_ROOT, VAULT_ID);
fs.mkdirSync(vaultDir, { recursive: true });

const config = require("../config");
config.refreshVaults();
const vaultRouter = require("./vault");
const fsRouter = require("./fs");
const bootstrap = require("./bootstrap");
const vaultLifecycle = require("../vault-lifecycle");
const express = require("express");

let server;
let base;
let wss;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/vault", vaultRouter);
  app.use("/api/fs", fsRouter);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  if (server) {
    server.close();
  }

  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vaultRouter._resetRefreshState();
  bootstrap.invalidateAll();
  wss = { broadcastToVault: vi.fn() };
  vaultLifecycle.setWss(wss);

  for (const entry of fs.readdirSync(vaultDir)) {
    fs.rmSync(path.join(vaultDir, entry), { recursive: true, force: true });
  }
});

const abs = (p) => path.join(vaultDir, p);

function refresh(body = { vault: VAULT_ID }) {
  return fetch(`${base}/api/vault/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("vault refresh route", () => {
  it("requires an explicit vault", async () => {
    const res = await refresh({});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Missing vault ID");
  });

  it("rejects an unknown vault", async () => {
    const res = await refresh({ vault: "missing" });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.id).toBe("missing");
  });

  it("forces a disk walk and replaces a cached tree after a file body changes", async () => {
    fs.writeFileSync(abs("same-size.md"), "aa");

    const first = await fetch(`${base}/api/fs/tree?vault=${VAULT_ID}`);
    const oldEtag = first.headers.get("etag");
    await first.json();

    fs.writeFileSync(abs("same-size.md"), "bb");

    const cached = await fetch(`${base}/api/fs/tree?vault=${VAULT_ID}`, {
      headers: { "If-None-Match": oldEtag },
    });
    expect(cached.status).toBe(304);

    const res = await refresh();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.treeRevision).not.toBe(oldEtag);
    expect(body.files).toBe(1);
    expect(body.directories).toBe(0);

    const after = await fetch(`${base}/api/fs/tree?vault=${VAULT_ID}`, {
      headers: { "If-None-Match": oldEtag },
    });
    expect(after.status).toBe(200);
  });

  it("broadcasts vault-refreshed after a successful refresh", async () => {
    fs.writeFileSync(abs("note.md"), "hi");

    const res = await refresh();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(wss.broadcastToVault).toHaveBeenCalledWith(VAULT_ID, {
      type: "vault-refreshed",
      treeRevision: body.treeRevision,
    });
  });

  it("enforces a cooldown after a successful refresh", async () => {
    fs.writeFileSync(abs("note.md"), "hi");

    expect((await refresh()).status).toBe(200);

    const res = await refresh();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.retryAfterMs).toBeGreaterThan(0);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects a second refresh while one is already running", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    vi.spyOn(bootstrap, "refreshVaultFromDisk").mockImplementation(async () => {
      await gate;
      return {
        treeRevision: '"slow"',
        files: 0,
        directories: 0,
      };
    });

    const first = refresh();
    await vi.waitFor(() => {
      expect(bootstrap.refreshVaultFromDisk).toHaveBeenCalled();
    });

    const second = await refresh();
    expect(second.status).toBe(409);

    release();
    expect((await first).status).toBe(200);
  });
});
