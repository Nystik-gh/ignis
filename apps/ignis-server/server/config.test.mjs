import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const CONFIG_ID = require.resolve("./config.js");

// Symlink creation needs privilege or Developer Mode on Windows; skip those cases where it fails.
let canSymlink = false;
try {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-symlink-probe-"));
  fs.symlinkSync(probe, path.join(probe, "l"), "dir");
  canSymlink = true;
  fs.rmSync(probe, { recursive: true, force: true });
} catch {
  canSymlink = false;
}

let root;
let target;
let dataRoot;

function loadVaults() {
  process.env.VAULT_ROOT = root;
  process.env.DATA_ROOT = dataRoot;
  delete process.env.AUTO_CREATE_DEFAULT;
  delete require.cache[CONFIG_ID];
  return require("./config.js").vaults;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-vaultroot-"));
  target = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-linktarget-"));
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-dataroot-"));

  fs.mkdirSync(path.join(root, "realvault"));
  fs.mkdirSync(path.join(root, ".hidden"));
  fs.writeFileSync(path.join(root, "notavault.md"), "x");

  if (canSymlink) {
    fs.symlinkSync(target, path.join(root, "linkvault"), "dir");
    fs.symlinkSync(path.join(target, "nope"), path.join(root, "dangling"), "dir");
  }
});

afterAll(() => {
  for (const d of [root, target, dataRoot]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("discoverVaults", () => {
  it("discovers a real directory and skips dotfiles and regular files", () => {
    const names = Object.keys(loadVaults());
    expect(names).toContain("realvault");
    expect(names).not.toContain(".hidden");
    expect(names).not.toContain("notavault.md");
  });

  it.skipIf(!canSymlink)("discovers a symlinked directory as a vault", () => {
    expect(Object.keys(loadVaults())).toContain("linkvault");
  });

  it.skipIf(!canSymlink)("skips a dangling symlink", () => {
    expect(Object.keys(loadVaults())).not.toContain("dangling");
  });
});
