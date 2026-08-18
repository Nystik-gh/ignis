import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);
const watcher = require("./watcher.js");

const VAULT_ID = "watch-test";

let tmpDir;
let globalListener;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  if (globalListener) {
    watcher.removeGlobalListener(globalListener);
    globalListener = null;
  }

  await watcher._reset();
  watcher._setIdleStopMs(null);

  if (tmpDir) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("watcher global listeners", () => {
  it("fires with the vault id and event for a direct disk write", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));
    const events = [];
    globalListener = (vaultId, event) => events.push({ vaultId, event });

    watcher.addGlobalListener(globalListener);
    watcher.startWatching(VAULT_ID, tmpDir);

    // Let chokidar's initial scan settle before creating the file it should report.
    await sleep(300);
    await fs.promises.writeFile(path.join(tmpDir, "a.md"), "x");

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), {
      timeout: 5000,
    });

    expect(events[0].vaultId).toBe(VAULT_ID);
    expect(events[0].event).toMatchObject({ type: "created", path: "a.md" });
  });

  it("stops firing after removeGlobalListener", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));
    const events = [];
    globalListener = (vaultId, event) => events.push({ vaultId, event });

    watcher.addGlobalListener(globalListener);
    watcher.startWatching(VAULT_ID, tmpDir);

    await sleep(300);
    watcher.removeGlobalListener(globalListener);
    await fs.promises.writeFile(path.join(tmpDir, "b.md"), "x");

    // The awaitWriteFinish stabilization window is 300ms; wait well past it.
    await sleep(1500);

    expect(events).toEqual([]);
  });
});

// The window must wait for chokidar's 300ms awaitWriteFinish.
const IDLE_MS = 2000;

describe("watcher idle stop", () => {
  beforeEach(() => {
    watcher._setIdleStopMs(IDLE_MS);
  });

  it("keeps watching until the idle window elapses after the last listener", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));
    const events = [];
    globalListener = (vaultId, event) => events.push(event);

    watcher.addGlobalListener(globalListener);
    watcher.startWatching(VAULT_ID, tmpDir);

    const listener = () => {};
    watcher.addListener(VAULT_ID, listener);

    await sleep(300);
    watcher.removeListener(VAULT_ID, listener);

    await sleep(50);
    await fs.promises.writeFile(path.join(tmpDir, "inside.md"), "x");

    await vi.waitFor(
      () => expect(events.some((e) => e.path === "inside.md")).toBe(true),
      { timeout: IDLE_MS },
    );

    await sleep(IDLE_MS + 500);
    await fs.promises.writeFile(path.join(tmpDir, "after.md"), "x");
    await sleep(1500);

    expect(events.some((e) => e.path === "after.md")).toBe(false);
  }, 20000);

  it("cancels the pending stop when a listener is re-added", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));
    const events = [];
    globalListener = (vaultId, event) => events.push(event);

    watcher.addGlobalListener(globalListener);
    const entry = watcher.startWatching(VAULT_ID, tmpDir);

    const first = () => {};
    watcher.addListener(VAULT_ID, first);

    await sleep(300);
    watcher.removeListener(VAULT_ID, first);
    await sleep(50);
    watcher.addListener(VAULT_ID, () => {});

    await sleep(IDLE_MS + 500);

    expect(watcher.startWatching(VAULT_ID, tmpDir)).toBe(entry);

    await fs.promises.writeFile(path.join(tmpDir, "reconnect.md"), "x");

    await vi.waitFor(
      () => expect(events.some((e) => e.path === "reconnect.md")).toBe(true),
      { timeout: 5000 },
    );
  }, 20000);

  it("cancels the pending stop on an explicit stopWatching", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));

    watcher.startWatching(VAULT_ID, tmpDir);

    const listener = () => {};
    watcher.addListener(VAULT_ID, listener);
    watcher.removeListener(VAULT_ID, listener);

    await expect(watcher.stopWatching(VAULT_ID)).resolves.toBeUndefined();

    const restarted = watcher.startWatching(VAULT_ID, tmpDir);
    watcher.addListener(VAULT_ID, () => {});
    await sleep(IDLE_MS + 500);

    expect(watcher.startWatching(VAULT_ID, tmpDir)).toBe(restarted);
  }, 20000);

  it("stops a watcher that never has a listener", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "watch-test-"));

    watcher.startWatching(VAULT_ID, tmpDir);
    await sleep(IDLE_MS + 500);

    expect(watcher.stopWatching(VAULT_ID)).toBeUndefined();
  }, 20000);
});
