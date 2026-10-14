import {
  describe,
  it,
  expect,
  vi,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "cache-verify-test-"));
process.env.VAULT_ROOT = VAULT_ROOT;

const VAULT_ID = "v";
const vaultDir = path.join(VAULT_ROOT, VAULT_ID);
fs.mkdirSync(vaultDir, { recursive: true });

const config = require("../config");
config.refreshVaults();
const bootstrapCache = require("./index");
const { watcher, writeCoalescer } = require("@ignis/server-core");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seed = (relPath, content) => {
  const abs = path.join(vaultDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

const build = () => bootstrapCache.getOrBuild(VAULT_ID);
const apply = (events) => bootstrapCache.applyMutation(VAULT_ID, events);
const verify = () => bootstrapCache.reconcileVault(VAULT_ID);

const swapped = [];

bootstrapCache.onEntrySwapped((vaultId, revision) =>
  swapped.push({ vaultId, revision }),
);

let warn;

function runMidCrawl(fn) {
  const realReaddir = fs.promises.readdir;
  let injected = false;

  return vi
    .spyOn(fs.promises, "readdir")
    .mockImplementation(async (dir, opts) => {
      const entries = await realReaddir(dir, opts);

      if (!injected && path.resolve(dir) === path.resolve(vaultDir)) {
        injected = true;
        await fn();
      }

      return entries;
    });
}

const verifyLines = () =>
  warn.mock.calls
    .map((args) => args.join(" "))
    .filter((line) => line.includes("[tree-reconcile]"));

beforeEach(() => {
  bootstrapCache.invalidateAll();
  writeCoalescer._reset();
  writeCoalescer.configure({ writeCoalesceMs: 0 });
  swapped.length = 0;
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  vi.spyOn(watcher, "isWatching").mockReturnValue(true);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  writeCoalescer._reset();
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

describe("a vault that matches its stored tree", () => {
  it("says nothing and keeps the entry", async () => {
    seed("a.md", "a");
    seed("d/b.md", "b");

    const entry = await build();
    const etag = entry.etag;

    swapped.length = 0;

    const result = await verify();

    expect(result.drifted).toBe(false);
    expect(verifyLines()).toEqual([]);
    expect(swapped).toEqual([]);
    expect(await build()).toBe(entry);
    expect(entry.etag).toBe(etag);
  });

  it("adopts the directory mtimes the applies left behind", async () => {
    seed("a.md", "a");

    const entry = await build();

    // Windows directory mtime granularity is coarser than back-to-back writes.
    await sleep(50);
    seed("b.md", "b");

    await apply({ type: "created", path: "b.md" });

    expect(entry.dirMtimes[""]).not.toBe(fs.statSync(vaultDir).mtimeMs);

    const result = await verify();

    expect(result.drifted).toBe(false);
    expect(entry.dirMtimes[""]).toBe(fs.statSync(vaultDir).mtimeMs);
    expect(await build()).toBe(entry);
  });

  it("ignores everything under .git", async () => {
    seed("a.md", "a");
    seed(".git/HEAD", "ref");

    const entry = await build();

    expect(entry.response.tree[".git/HEAD"]).toBeUndefined();
    expect(entry.response.tree[".git"]).toBeUndefined();
    expect(entry.dirMtimes[".git"]).toBeUndefined();

    seed(".git/objects/aa/bb", "obj");
    fs.rmSync(path.join(vaultDir, ".git", "HEAD"));

    const result = await verify();

    expect(result.drifted).toBe(false);
    expect(verifyLines()).toEqual([]);
    expect(await build()).toBe(entry);
  });

  it("ignores a file whose write is still buffered", async () => {
    writeCoalescer.configure({ writeCoalesceMs: 5000 });

    const abs = path.join(vaultDir, "x.md");

    await writeCoalescer.writeCoalesced(abs, "v1", "utf-8");

    const entry = await build();

    await writeCoalescer.writeCoalesced(abs, "v2-longer", "utf-8");
    expect(writeCoalescer.getPending(abs)).not.toBeNull();

    await apply({
      type: "modified",
      path: "x.md",
      stat: { size: 9, mtime: Date.now(), ctime: Date.now() },
    });

    const result = await verify();

    expect(result.drifted).toBe(false);
    expect(entry.response.tree["x.md"].size).toBe(9);
  });

  it("ignores a buffered file the crawl watched reach disk", async () => {
    writeCoalescer.configure({ writeCoalesceMs: 5000 });

    const abs = path.join(vaultDir, "x.md");

    await writeCoalescer.writeCoalesced(abs, "v1", "utf-8");

    const entry = await build();
    const written = await writeCoalescer.writeCoalesced(
      abs,
      "v2-longer",
      "utf-8",
    );

    await apply({
      type: "modified",
      path: "x.md",
      stat: { size: written.size, mtime: written.mtime, ctime: written.mtime },
    });

    const readdirSpy = runMidCrawl(() => writeCoalescer.flushPending(abs));

    const result = await verify();

    readdirSpy.mockRestore();

    expect(writeCoalescer.getPending(abs)).toBeNull();
    expect(fs.readFileSync(abs, "utf-8")).toBe("v2-longer");
    expect(result.drifted).toBe(false);
    expect(verifyLines()).toEqual([]);
    expect(await build()).toBe(entry);
  });
});

describe("a vault that has drifted from its stored tree", () => {
  it("replaces the entry and announces the replacement", async () => {
    seed("a.md", "a");

    const entry = await build();

    seed("unseen.md", "unseen");
    swapped.length = 0;

    const result = await verify();
    const replacement = await build();

    expect(result).toMatchObject({ drifted: true, missing: ["unseen.md"] });
    expect(replacement).not.toBe(entry);
    expect(replacement.response.tree["unseen.md"]).toMatchObject({
      type: "file",
    });
    expect(swapped).toEqual([
      { vaultId: VAULT_ID, revision: replacement.etag },
    ]);
  });

  it("names the vault and what drifted", async () => {
    seed("a.md", "a");
    seed("gone.md", "gone");

    await build();

    seed("appeared.md", "appeared");
    fs.rmSync(path.join(vaultDir, "gone.md"));

    const result = await verify();

    expect(result).toMatchObject({
      drifted: true,
      missing: ["appeared.md"],
      extra: ["gone.md"],
    });
    expect(verifyLines()).toEqual([
      "[tree-reconcile] vault=v drift missing=1 extra=1 changed=0 " +
        "(appeared.md, gone.md)",
    ]);
  });

  it("reports a file whose recorded size no longer matches disk", async () => {
    seed("a.md", "a");

    await build();

    await apply({
      type: "modified",
      path: "a.md",
      stat: { size: 4242, mtime: 1, ctime: 1 },
    });

    const result = await verify();

    expect(result).toMatchObject({ drifted: true, changed: ["a.md"] });
    expect((await build()).response.tree["a.md"].size).toBe(1);
  });
});

describe("mutations that land while the verify crawls", () => {
  it("survive the entry they were applied to being replaced", async () => {
    seed("a.md", "a");

    const entry = await build();

    seed("unseen.md", "unseen");

    const readdirSpy = runMidCrawl(async () => {
      seed("late.md", "late");
      await apply({ type: "created", path: "late.md" });
    });

    await verify();

    readdirSpy.mockRestore();

    const replacement = await build();

    expect(replacement).not.toBe(entry);
    expect(entry.response.tree["late.md"]).toMatchObject({ type: "file" });
    expect(replacement.response.tree["late.md"]).toMatchObject({
      type: "file",
    });
    expect(replacement.response.tree["unseen.md"]).toMatchObject({
      type: "file",
    });
  });

  it("are not read as drift on a vault that agrees with disk", async () => {
    seed("a.md", "a");

    const entry = await build();

    const readdirSpy = runMidCrawl(async () => {
      seed("late.md", "late");
      await apply({ type: "created", path: "late.md" });
    });

    const result = await verify();

    readdirSpy.mockRestore();

    expect(result.drifted).toBe(false);
    expect(verifyLines()).toEqual([]);
    expect(await build()).toBe(entry);
    expect(entry.response.tree["late.md"]).toMatchObject({ type: "file" });
  });

  it("does not read a directory added by a mid-crawl create as drift", async () => {
    seed("a.md", "a");

    const entry = await build();

    swapped.length = 0;

    const readdirSpy = runMidCrawl(async () => {
      seed("newdir/late.md", "late");
      await apply({ type: "created", path: "newdir/late.md" });
    });

    const result = await verify();

    readdirSpy.mockRestore();

    expect(result.drifted).toBe(false);
    expect(verifyLines()).toEqual([]);
    expect(swapped).toEqual([]);
    expect(await build()).toBe(entry);
  });
});

describe("an invalidation that lands while the verify crawls", () => {
  it("leaves the vault to the crawl the next request pays for", async () => {
    seed("a.md", "a");

    await build();

    seed("unseen.md", "unseen");
    swapped.length = 0;

    const readdirSpy = runMidCrawl(() => {
      bootstrapCache.invalidateVault(VAULT_ID);
    });

    const result = await verify();

    readdirSpy.mockRestore();

    expect(result).toBeNull();
    expect(swapped).toEqual([]);

    const rebuilt = await build();

    expect(rebuilt.response.tree["unseen.md"]).toMatchObject({ type: "file" });
  });

  it("discards the replacement when invalidated during its replay", async () => {
    seed("a.md", "a");

    await build();

    seed("unseen.md", "unseen");
    swapped.length = 0;

    const readdirSpy = runMidCrawl(async () => {
      seed("newdir/late.md", "late");
      await apply({ type: "created", path: "newdir/late.md" });
    });

    const realStat = fs.promises.stat;
    let replaying = false;
    let invalidatedAt = null;

    // use console.warn for timing, TODO: stop relying on warn
    warn.mockImplementation(() => {
      replaying = true;
    });

    const statSpy = vi
      .spyOn(fs.promises, "stat")
      .mockImplementation((p, ...rest) => {
        if (replaying && invalidatedAt === null) {
          invalidatedAt = String(p);
          bootstrapCache.invalidateVault(VAULT_ID);
        }

        return realStat.call(fs.promises, p, ...rest);
      });

    const result = await verify();

    readdirSpy.mockRestore();
    statSpy.mockRestore();

    expect(result.drifted).toBe(true);
    expect(invalidatedAt).toContain("newdir");
    expect(swapped).toEqual([]);

    const rebuilt = await build();

    expect(rebuilt.response.tree["unseen.md"]).toMatchObject({ type: "file" });
    expect(rebuilt.response.tree["newdir/late.md"]).toMatchObject({
      type: "file",
    });
  });

  it("discards the replacement when invalidated before its swap", async () => {
    seed("a.md", "a");

    const entry = await build();

    seed("unseen.md", "unseen");
    swapped.length = 0;

    // use console.warn for timing, TODO: stop relying on warn
    warn.mockImplementation(() => bootstrapCache.invalidateVault(VAULT_ID));

    await verify();

    expect(swapped).toEqual([]);

    const rebuilt = await build();

    expect(rebuilt).not.toBe(entry);
    expect(rebuilt.response.tree["unseen.md"]).toMatchObject({ type: "file" });
  });

  it("does not adopt dir mtimes after being superseded", async () => {
    seed("a.md", "a");

    await build();

    let rebuilt;
    let freshMtime;

    const readdirSpy = runMidCrawl(async () => {
      bootstrapCache.invalidateVault(VAULT_ID);
      await sleep(50);
      seed("temp.md", "temp");
      fs.rmSync(path.join(vaultDir, "temp.md"));
      rebuilt = await build();
      freshMtime = rebuilt.dirMtimes[""];
    });

    const result = await verify();

    readdirSpy.mockRestore();

    expect(result.drifted).toBe(false);
    expect(rebuilt.dirMtimes[""]).toBe(freshMtime);
  });
});

describe("vaults the verify stands down for", () => {
  it("does not crawl a vault with no stored entry", async () => {
    seed("a.md", "a");

    const readdirSpy = vi.spyOn(fs.promises, "readdir");

    expect(await verify()).toBeNull();
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it("does not crawl a vault that is not configured", async () => {
    expect(await bootstrapCache.reconcileVault("no-such-vault")).toBeNull();
  });
});
