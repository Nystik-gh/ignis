import { describe, it, expect, afterEach, afterAll } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vault-lifecycle-"));
process.env.VAULT_ROOT = VAULT_ROOT;
process.env.DATA_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "vault-lifecycle-data-"),
);

const VAULT_ID = "lifecycle";
const vaultPath = path.join(VAULT_ROOT, VAULT_ID);
fs.mkdirSync(vaultPath, { recursive: true });

const { setWss, withWatcherStopped } = require("./vault-lifecycle");
const { watcher } = require("@ignis/server-core");

function recordingWss() {
  const bounced = [];

  setWss({ closeVaultSockets: (vaultId) => bounced.push(vaultId) });

  return bounced;
}

afterEach(async () => {
  setWss(null);
  await watcher._reset();
});

afterAll(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

describe("withWatcherStopped", () => {
  it("restores the watcher and bounces the sockets when the mutation fails", async () => {
    const bounced = recordingWss();
    const failure = new Error("rename failed");

    watcher.startWatching(VAULT_ID, vaultPath);

    await expect(
      withWatcherStopped(VAULT_ID, vaultPath, () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    const stopping = watcher.stopWatching(VAULT_ID);

    expect(stopping).toBeInstanceOf(Promise);
    await stopping;

    expect(bounced).toEqual([VAULT_ID]);
  });

  it("doesn't start a watcher when the mutation fails for an unwatched vault", async () => {
    const bounced = recordingWss();

    await expect(
      withWatcherStopped(VAULT_ID, vaultPath, () =>
        Promise.reject(new Error("rm failed")),
      ),
    ).rejects.toThrow("rm failed");

    expect(watcher.stopWatching(VAULT_ID)).toBeUndefined();
    expect(bounced).toEqual([]);
  });

  it("leaves the watcher stopped when the mutation succeeds", async () => {
    const bounced = recordingWss();

    watcher.startWatching(VAULT_ID, vaultPath);

    await expect(
      withWatcherStopped(VAULT_ID, vaultPath, async () => "renamed"),
    ).resolves.toBe("renamed");

    expect(watcher.stopWatching(VAULT_ID)).toBeUndefined();
    expect(bounced).toEqual([]);
  });

  it("rethrows the mutation error", async () => {
    await expect(
      withWatcherStopped(VAULT_ID, vaultPath, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
