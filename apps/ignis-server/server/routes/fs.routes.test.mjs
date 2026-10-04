import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
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
const bootstrapCache = require("../cache");
const { writeCoalescer, watcher } = require("@ignis/server-core");
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
  bootstrapCache.invalidateAll(); // start from a cold cache

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
const rmRecursive = (p) =>
  fetch(u(`rm?${q(p)}&recursive=true`), { method: "DELETE" });

const settle = async () => {
  await sleep(30);
  await bootstrapCache.applyMutation(VAULT_ID, []); // wait for queue
};

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

  it("download serves a pending binary-encoded string as the utf-8 bytes that flush to disk", async () => {
    const p = abs("bin.md");
    const s = "ab" + String.fromCodePoint(0x00e9);

    await writeCoalescer.writeCoalesced(p, "v1", "utf-8");
    await writeCoalescer.writeCoalesced(p, s, "binary");
    expect(writeCoalescer.getPending(p)).not.toBeNull();

    const body = Buffer.from(
      await (await fetch(u(`download?${q("bin.md")}`))).arrayBuffer(),
    );

    expect(body).toEqual(Buffer.from(s, "utf-8"));
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

describe("tree route root responses come from the bootstrap cache", () => {
  const getTree = async (query) => (await fetch(u(`tree?${query}`))).json();

  it("includes a file written through the writeFile route", async () => {
    await writeFile("fresh.md", "hello");

    const tree = await getTree(`vault=${VAULT_ID}`);

    expect(tree["fresh.md"]).toMatchObject({ type: "file" });
  });

  it("serves the tree it holds when a file appears outside the HTTP routes", async () => {
    await writeFile("seed.md", "seed");
    await getTree(`vault=${VAULT_ID}`);

    // Windows directory mtime granularity is coarser than back-to-back writes.
    await sleep(50);
    fs.writeFileSync(abs("direct.md"), "direct");

    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    let stale;

    try {
      stale = await getTree(`vault=${VAULT_ID}`);
    } finally {
      spy.mockRestore();
    }

    expect(stale["direct.md"]).toBeUndefined();
    expect(logs.filter((l) => l.includes("build files="))).toEqual([]);

    await bootstrapCache.reconcileVault(VAULT_ID);

    const healed = await getTree(`vault=${VAULT_ID}`);

    expect(healed["direct.md"]).toMatchObject({ type: "file" });
    expect(healed["seed.md"]).toMatchObject({ type: "file" });
  });

  it("serves two concurrent root requests from one build", async () => {
    await writeFile("dedup.md", "x");

    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    let first, second;

    try {
      [first, second] = await Promise.all([
        getTree(`vault=${VAULT_ID}`),
        getTree(`vault=${VAULT_ID}`),
      ]);
    } finally {
      spy.mockRestore();
    }

    expect(first["dedup.md"]).toMatchObject({ type: "file" });
    expect(second).toEqual(first);
    expect(logs.filter((l) => l.includes("[bootstrap]"))).toHaveLength(1);
  });
});

describe("tree route conditional fetch via ETag", () => {
  const getTree = (query, headers) =>
    fetch(u(`tree?${query}`), headers ? { headers } : undefined);

  it("returns an ETag header on the root tree", async () => {
    await writeFile("etag-seed.md", "hi");

    const res = await getTree(`vault=${VAULT_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("returns 304 with an empty body when If-None-Match matches", async () => {
    await writeFile("etag-match.md", "hi");

    const first = await getTree(`vault=${VAULT_ID}`);
    const etag = first.headers.get("etag");
    await first.json();

    const second = await getTree(`vault=${VAULT_ID}`, {
      "If-None-Match": etag,
    });

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  it("serves 200 with the new file and a changed ETag after a write", async () => {
    await writeFile("base.md", "hi");

    const first = await getTree(`vault=${VAULT_ID}`);
    const oldEtag = first.headers.get("etag");
    await first.json();

    await writeFile("added.md", "new");
    await settle();

    const second = await getTree(`vault=${VAULT_ID}`, {
      "If-None-Match": oldEtag,
    });
    const tree = await second.json();
    const newEtag = second.headers.get("etag");

    expect(second.status).toBe(200);
    expect(tree["added.md"]).toMatchObject({ type: "file" });
    expect(newEtag).not.toBe(oldEtag);
  });
});

describe("mutation routes apply to a watched vault's tree", () => {
  const treeRes = (headers) =>
    fetch(u(`tree?vault=${VAULT_ID}`), headers ? { headers } : undefined);
  const tree = async () => (await treeRes()).json();

  let logs;

  function captureLogs() {
    logs = [];

    return vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  }

  const crawlLines = () => logs.filter((l) => l.includes("build files="));

  beforeEach(() => {
    bootstrapCache.invalidateAll();
    vi.spyOn(watcher, "isWatching").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a written file without crawling the vault", async () => {
    await tree();

    const spy = captureLogs();

    try {
      await writeFile("applied.md", "hello");
      await settle();

      expect((await tree())["applied.md"]).toMatchObject({
        type: "file",
        size: 5,
      });
    } finally {
      spy.mockRestore();
    }

    expect(crawlLines()).toEqual([]);
  });

  it("skips a write to a path no watcher reports on", async () => {
    const before = await treeRes();
    await before.json();

    const spy = captureLogs();
    let after;

    try {
      expect((await writeFile(".git/index", "gitdata")).ok).toBe(true);
      await settle();

      after = await treeRes();
    } finally {
      spy.mockRestore();
    }

    expect(exists(".git/index")).toBe(true);
    expect((await after.json())[".git/index"]).toBeUndefined();
    expect(after.headers.get("etag")).toBe(before.headers.get("etag"));
    expect(crawlLines()).toEqual([]);
  });

  it("adds a file renamed out of an ignored folder to the tree", async () => {
    watcher.configure({ ignoredPaths: ["@eaDir"] });

    try {
      await tree();
      await writeFile("@eaDir/moved.md", "m");
      await writeFile("kept/anchor.md", "k");
      await settle();
      expect((await tree())["@eaDir/moved.md"]).toBeUndefined();

      expect((await rename("@eaDir/moved.md", "kept/moved.md")).ok).toBe(true);
      await settle();

      expect((await tree())["kept/moved.md"]).toBeDefined();
    } finally {
      watcher.configure({ ignoredPaths: [".git"] });
    }
  });

  it("drops a file renamed into an ignored folder from the tree", async () => {
    watcher.configure({ ignoredPaths: ["@eaDir"] });

    try {
      await tree();
      await mkdir("@eaDir");
      await writeFile("kept/leaving.md", "l");
      await settle();
      expect((await tree())["kept/leaving.md"]).toBeDefined();

      expect((await rename("kept/leaving.md", "@eaDir/leaving.md")).ok).toBe(
        true,
      );
      await settle();

      expect((await tree())["kept/leaving.md"]).toBeUndefined();
    } finally {
      watcher.configure({ ignoredPaths: [".git"] });
    }
  });

  it("skips a write to a path a configured pattern covers", async () => {
    watcher.configure({ ignoredPaths: ["@eaDir"] });

    const before = await treeRes();
    await before.json();

    const spy = captureLogs();
    let after;

    try {
      expect((await writeFile("@eaDir/thumb.jpg", "jpg")).ok).toBe(true);
      await settle();

      after = await treeRes();
    } finally {
      spy.mockRestore();
      watcher.configure({ ignoredPaths: [".git"] });
    }

    expect(exists("@eaDir/thumb.jpg")).toBe(true);
    expect((await after.json())["@eaDir/thumb.jpg"]).toBeUndefined();
    expect(after.headers.get("etag")).toBe(before.headers.get("etag"));
    expect(crawlLines()).toEqual([]);
  });

  it("materializes the directories a deep write passes through", async () => {
    await tree();

    const spy = captureLogs();
    let current;

    try {
      await writeFile("a/b/c.md", "c");
      await settle();

      current = await tree();
    } finally {
      spy.mockRestore();
    }

    expect(current["a"]).toEqual({ type: "directory" });
    expect(current["a/b"]).toEqual({ type: "directory" });
    expect(current["a/b/c.md"]).toMatchObject({ type: "file" });
    expect(crawlLines()).toEqual([]);
  });

  it("advances the ETag once per mutation and holds it in between", async () => {
    const first = await treeRes();
    await first.json();

    const spy = captureLogs();
    let second, third, repeat;

    try {
      await writeFile("etag-a.md", "a");
      await settle();

      second = await treeRes();
      await second.json();

      await unlink("etag-a.md");
      await settle();

      third = await treeRes();
      await third.json();

      repeat = await treeRes({ "If-None-Match": third.headers.get("etag") });
    } finally {
      spy.mockRestore();
    }

    const etags = [first, second, third].map((r) => r.headers.get("etag"));

    expect(new Set(etags).size).toBe(3);
    expect(repeat.status).toBe(304);
    expect(crawlLines()).toEqual([]);
  });

  it("records the size a pending write reports, not the size on disk", async () => {
    await tree();

    const spy = captureLogs();
    let node;

    try {
      await bufferWrite("x.md", "v1", "v2buffered");
      await settle();

      node = (await tree())["x.md"];
    } finally {
      spy.mockRestore();
    }

    expect(node.size).toBe(Buffer.byteLength("v2buffered"));
    expect(fs.statSync(abs("x.md")).size).toBe(Buffer.byteLength("v1"));
    expect(crawlLines()).toEqual([]);
  });

  it("moves a renamed subtree", async () => {
    await tree();
    await writeFile("src/deep/note.md", "note");
    await settle();

    const spy = captureLogs();
    let current;

    try {
      expect((await rename("src", "dst")).ok).toBe(true);
      await settle();

      current = await tree();
    } finally {
      spy.mockRestore();
    }

    expect(crawlLines()).toEqual([]);
    expect(current["dst"]).toEqual({ type: "directory" });
    expect(current["dst/deep"]).toEqual({ type: "directory" });
    expect(current["dst/deep/note.md"]).toMatchObject({ type: "file" });
    expect(
      Object.keys(current).filter((k) => k === "src" || k.startsWith("src/")),
    ).toEqual([]);
  });

  it("sweeps a recursively removed directory out of the tree", async () => {
    await tree();
    await writeFile("d/one.md", "one");
    await writeFile("d/sub/two.md", "two");
    await settle();

    expect((await tree())["d/sub/two.md"]).toMatchObject({ type: "file" });

    const spy = captureLogs();
    let current;

    try {
      expect((await rmRecursive("d")).ok).toBe(true);
      await settle();

      current = await tree();
    } finally {
      spy.mockRestore();
    }

    expect(crawlLines()).toEqual([]);
    expect(
      Object.keys(current).filter((k) => k === "d" || k.startsWith("d/")),
    ).toEqual([]);
  });
});

describe("bootstrap cache walkTree", () => {
  it("reports the buffered size for a pending coalesced write", async () => {
    const p = abs("x.md");

    await writeCoalescer.writeCoalesced(p, "v1", "utf-8");
    await writeCoalescer.writeCoalesced(p, "v2bootstrap", "utf-8");
    expect(writeCoalescer.getPending(p)).not.toBeNull();

    const { tree } = await bootstrapCache.walkTree(vaultDir);

    expect(tree["x.md"].size).toBe(Buffer.byteLength("v2bootstrap"));
  });
});

describe("utimes route", () => {
  const TOUCHED_MS = 1783339200123;
  const utimes = (p, mtime) =>
    postJson("utimes", { path: p, atime: mtime, mtime });

  beforeEach(() => {
    bootstrapCache.invalidateAll();
    vi.spyOn(watcher, "isWatching").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 404 for a path that does not exist", async () => {
    const res = await utimes("missing.md", TOUCHED_MS);

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("ENOENT");
  });

  it("returns the times the touch left on disk", async () => {
    await writeFile("touched.md", "hello");

    const res = await utimes("touched.md", TOUCHED_MS);
    const body = await res.json();
    const stat = fs.statSync(abs("touched.md"));

    expect(body).toMatchObject({
      type: "file",
      size: 5,
      mtime: stat.mtimeMs,
    });
    expect(Math.round(body.mtime)).toBe(TOUCHED_MS);
    expect(typeof body.ctime).toBe("number");
  });

  it("lands after a buffered write, so the touched mtime holds", async () => {
    await bufferWrite("buffered.md", "v1", "v2");

    expect((await utimes("buffered.md", TOUCHED_MS)).ok).toBe(true);
    await sleep(WINDOW + 200);

    expect(onDisk("buffered.md")).toBe("v2");
    expect(Math.round(fs.statSync(abs("buffered.md")).mtimeMs)).toBe(
      TOUCHED_MS,
    );
  });

  it("leaves a touched dir a dir in the tree", async () => {
    await mkdir("d");
    await writeFile("d/f.md", "x");
    await fetch(u(`tree?vault=${VAULT_ID}`)).then((r) => r.json());

    expect((await utimes("d", TOUCHED_MS)).ok).toBe(true);
    await settle();

    const tree = await fetch(u(`tree?vault=${VAULT_ID}`)).then((r) => r.json());

    expect(tree["d"]).toMatchObject({ type: "directory" });
  });
});
