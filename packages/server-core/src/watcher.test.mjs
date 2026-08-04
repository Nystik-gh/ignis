import { describe, it, expect, afterEach, vi } from "vitest";
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

  watcher.stopWatching(VAULT_ID);

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
