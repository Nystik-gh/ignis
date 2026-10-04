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

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "settings-route-"));
const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "settings-route-v-"));
process.env.DATA_ROOT = DATA_ROOT;
process.env.VAULT_ROOT = VAULT_ROOT;

const VAULT_ID = "v";
const vaultDir = path.join(VAULT_ROOT, VAULT_ID);
fs.mkdirSync(path.join(vaultDir, "@eaDir"), { recursive: true });

const config = require("../config");
config.refreshVaults();
const settings = require("../settings");
const settingsRouter = require("./settings");
const bootstrapCache = require("../cache");
const { watcher } = require("@ignis/server-core");
const express = require("express");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await watcher._reset();

  if (server) {
    server.close();
  }

  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await watcher._reset();
  bootstrapCache.invalidateAll();
  settings.update({ ignoreRules: settings.DEFAULTS.ignoreRules });
  watcher.configure({ ignoredPaths: settings.resolveIgnoreLines() });
});

const post = (body) =>
  fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function writeHeavyPlugin() {
  for (let i = 0; i < 501; i++) {
    const file = path.join(
      vaultDir,
      ".obsidian",
      "plugins",
      "heavy",
      "icons",
      `f${i}.svg`,
    );

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "s");
  }
}

describe("POST /api/settings with a new ignore list", () => {
  it("stops the running watchers and restarts them on the new list", async () => {
    watcher.startWatching(VAULT_ID, vaultDir);
    await vi.waitFor(() => expect(watcher.isWatching(VAULT_ID)).toBe(true), {
      timeout: 5000,
    });

    const res = await post({
      ignoreRules: [{ name: "System", patterns: [".git"] }],
    });

    expect(res.status).toBe(200);
    expect((await res.json()).ignoreRules).toEqual([
      { name: "System", patterns: [".git"] },
    ]);
    expect(watcher.isWatching(VAULT_ID)).toBe(false);
    expect(watcher.isIgnoredPath("@eaDir/thumb.jpg")).toBe(false);

    const events = [];

    watcher.addGlobalListener((vaultId, event) => events.push(event.path));
    watcher.startWatching(VAULT_ID, vaultDir);

    await sleep(300);
    fs.writeFileSync(path.join(vaultDir, "@eaDir", "thumb.jpg"), "x");

    await vi.waitFor(() => expect(events).toContain("@eaDir/thumb.jpg"), {
      timeout: 5000,
    });
  }, 20000);

  it("leaves the watchers alone when the list is unchanged", async () => {
    watcher.startWatching(VAULT_ID, vaultDir);
    await vi.waitFor(() => expect(watcher.isWatching(VAULT_ID)).toBe(true), {
      timeout: 5000,
    });

    const res = await post({ writeCoalesceMs: 0 });

    expect(res.status).toBe(200);
    expect(watcher.isWatching(VAULT_ID)).toBe(true);
  }, 20000);

  it("returns the suggestions covered by the saved list", async () => {
    writeHeavyPlugin();
    await bootstrapCache.getOrBuild(VAULT_ID);

    const res = await post({
      ignoreRules: [
        ...settings.DEFAULTS.ignoreRules,
        { name: "Plugins", patterns: [".obsidian/plugins/heavy/icons"] },
      ],
    });

    expect(res.status).toBe(200);
    expect((await res.json()).ignoreSuggestions).toEqual([
      {
        vault: VAULT_ID,
        pluginDir: ".obsidian/plugins/heavy",
        fileCount: 501,
        patterns: [".obsidian/plugins/heavy/icons"],
        covered: true,
      },
    ]);
  }, 20000);
});

describe("GET /api/settings", () => {
  it("carries the suggestions the modal reads", async () => {
    writeHeavyPlugin();
    await bootstrapCache.getOrBuild(VAULT_ID);

    const body = await (await fetch(`${base}/api/settings`)).json();

    expect(body.ignoreSuggestions).toEqual([
      {
        vault: VAULT_ID,
        pluginDir: ".obsidian/plugins/heavy",
        fileCount: 501,
        patterns: [".obsidian/plugins/heavy/icons"],
        covered: false,
      },
    ]);
  }, 20000);
});
