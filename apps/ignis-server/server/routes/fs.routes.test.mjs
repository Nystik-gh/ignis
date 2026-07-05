import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

// setup test vault
const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "fs-route-test-"));
process.env.VAULT_ROOT = VAULT_ROOT;
const VAULT_ID = "v";
const vaultDir = path.join(VAULT_ROOT, VAULT_ID);
fs.mkdirSync(vaultDir, { recursive: true });

const config = require("../config");
config.refreshVaults();
const fsRouter = require("./fs");
const bootstrap = require("./bootstrap");
const { writeCoalescer } = require("@ignis/server-core");
const express = require("express");

// Window must exceed two sequential localhost round-trips so the second write to a path buffers.
const WINDOW = 400;
writeCoalescer.configure({ writeCoalesceMs: WINDOW });

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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

  writeCoalescer._reset();
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  writeCoalescer._reset();

  for (const entry of fs.readdirSync(vaultDir)) {
    fs.rmSync(path.join(vaultDir, entry), { recursive: true, force: true });
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u = (p) => `${base}/api/fs/${p}`;
const q = (p) => `vault=${VAULT_ID}&path=${encodeURIComponent(p)}`;
const onDisk = (p) => fs.readFileSync(path.join(vaultDir, p), "utf-8");
const exists = (p) => fs.existsSync(path.join(vaultDir, p));
const abs = (p) => path.join(vaultDir, p);

const postJson = (p, body) =>
  fetch(u(p), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vault: VAULT_ID, ...body }),
  });

const writeFile = (p, content) => postJson("writeFile", { path: p, content });
const mkdir = (p) => postJson("mkdir", { path: p });
const rename = (oldPath, newPath) => postJson("rename", { oldPath, newPath });
const copyFile = (src, dest) => postJson("copyFile", { src, dest });
const appendFile = (p, content) => postJson("appendFile", { path: p, content });
const unlink = (p) => fetch(u(`unlink?${q(p)}`), { method: "DELETE" });
const rmdir = (p) => fetch(u(`rmdir?${q(p)}`), { method: "DELETE" });

// Seed a buffered write: first write hits disk, second is held in the coalescer buffer.
async function bufferWrite(p, first, second) {
  await writeFile(p, first);
  await writeFile(p, second);
  expect(writeCoalescer.getPending(abs(p))).not.toBeNull();
}

describe("fs route handlers reconcile the coalescer buffer (WRITE_COALESCE_MS > 0)", () => {
  it("unlink does not resurrect a deleted file", async () => {
    await bufferWrite("x.md", "v1", "v2");

    expect((await unlink("x.md")).ok).toBe(true);
    await sleep(WINDOW + 200);

    expect(exists("x.md")).toBe(false);
  });

  it("rename drops the destination buffer so it cannot clobber the renamed-in file", async () => {
    await writeFile("a.md", "AAAA");
    await bufferWrite("b.md", "b1", "b2b2");

    expect((await rename("a.md", "b.md")).ok).toBe(true);
    await sleep(WINDOW + 200);

    expect(onDisk("b.md")).toBe("AAAA");
    expect(exists("a.md")).toBe(false);
  });

  it("a failed rmdir keeps the buffered writes for files that survive", async () => {
    await mkdir("d");
    await bufferWrite("d/f.md", "v1", "v2new");

    expect((await rmdir("d")).ok).toBe(false); // ENOTEMPTY
    await sleep(WINDOW + 200);

    expect(onDisk("d/f.md")).toBe("v2new");
  });

  it("copyFile copies the buffered source content, not stale disk", async () => {
    await bufferWrite("s.md", "s1", "s2x");

    expect((await copyFile("s.md", "dest.md")).ok).toBe(true);

    expect(onDisk("dest.md")).toBe("s2x");
  });

  it("appendFile appends onto the buffered content without losing the append", async () => {
    await bufferWrite("x.md", "base1", "base2");

    expect((await appendFile("x.md", "APP")).ok).toBe(true);
    await sleep(WINDOW + 200);

    expect(onDisk("x.md")).toBe("base2APP");
  });

  it("download serves the buffered content, not stale disk", async () => {
    await bufferWrite("x.md", "v1", "v2download");

    const body = await (await fetch(u(`download?${q("x.md")}`))).text();

    expect(body).toBe("v2download");
  });

  it("tree reports the buffered size, not stale disk", async () => {
    await bufferWrite("x.md", "v1", "v2tree");

    const tree = await (await fetch(u(`tree?vault=${VAULT_ID}`))).json();

    expect(tree["x.md"].size).toBe(Buffer.byteLength("v2tree"));
  });

  it("download-zip flushes buffered writes so the archive holds current bytes", async () => {
    await mkdir("d");
    await bufferWrite("d/f.md", "v1", "v2zip");

    await (await fetch(u(`download-zip?${q("d")}`))).arrayBuffer();

    // flush-before-zip persists the buffer immediately, before the debounce window elapses.
    expect(onDisk("d/f.md")).toBe("v2zip");
    expect(writeCoalescer.getPending(abs("d/f.md"))).toBeNull();
  });
});

describe("bootstrap walkTree", () => {
  it("reports the buffered size for a pending coalesced write", async () => {
    const p = abs("x.md");

    await writeCoalescer.writeCoalesced(p, "v1", "utf-8");
    await writeCoalescer.writeCoalesced(p, "v2bootstrap", "utf-8");
    expect(writeCoalescer.getPending(p)).not.toBeNull();

    const { tree } = await bootstrap.walkTree(vaultDir);

    expect(tree["x.md"].size).toBe(Buffer.byteLength("v2bootstrap"));
  });
});
