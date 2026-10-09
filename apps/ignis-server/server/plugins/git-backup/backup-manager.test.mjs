import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { BackupManager } = require("./backup-manager");
const implementation = require("isomorphic-git");
const runGit = (args, cwd) => promisify(execFile)("git", args, { cwd });

let root;
let vaultPath;
let ctx;
let manager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-backup-"));
  vaultPath = path.join(root, "Vault with spaces");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(vaultPath);
  fs.mkdirSync(dataDir);
  ctx = {
    dataDir,
    config: { getVaultPath: (id) => (id === "v1" ? vaultPath : null) },
    log: vi.fn(),
    dependencies: { require: () => implementation },
  };
  manager = new BackupManager(ctx);
});

afterEach(async () => {
  await manager.shutdown();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

function write(relative, content) {
  const file = path.join(vaultPath, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function repositoryGit(...args) {
  const repository = path.join(manager.vaultDataDir("v1"), "repository.git");
  const { stdout } = await runGit([`--git-dir=${repository}`, ...args]);
  return stdout;
}

describe("Git vault snapshots", () => {
  it("captures additions, edits, deletions, and binary files with recoverable history", async () => {
    write("Notes/a note.md", "original content\n");
    write("-attachment.bin", Buffer.from([0, 255, 10, 13]));
    await manager.enableVault("v1", vaultPath);
    const original = manager.getState("v1").lastCommit;

    expect(await repositoryGit("show", `${original}:Notes/a note.md`)).toBe(
      "original content\n",
    );
    expect(await repositoryGit("rev-list", "--count", "HEAD")).toBe("1\n");
    expect(fs.existsSync(path.join(vaultPath, ".git"))).toBe(false);
    expect((await manager.backup("v1")).committed).toBe(false);
    expect(await repositoryGit("rev-list", "--count", "HEAD")).toBe("1\n");

    write("Notes/a note.md", "incorrect edit\n");
    expect((await manager.backup("v1")).committed).toBe(true);
    fs.rmSync(path.join(vaultPath, "Notes/a note.md"));
    await manager.backup("v1");

    expect(await repositoryGit("rev-list", "--count", "HEAD")).toBe("3\n");
    expect(await repositoryGit("ls-tree", "-r", "--name-only", "HEAD")).toBe(
      "-attachment.bin\n",
    );
    expect(await repositoryGit("show", `${original}:Notes/a note.md`)).toBe(
      "original content\n",
    );
    const { stdout } = await promisify(execFile)(
      "git",
      [
        `--git-dir=${path.join(manager.vaultDataDir("v1"), "repository.git")}`,
        "show",
        "HEAD:-attachment.bin",
      ],
      { encoding: "buffer" },
    );
    expect(stdout).toEqual(Buffer.from([0, 255, 10, 13]));
    expect(manager.getState("v1").lastCheckedAt).not.toBeNull();
  });

  it("respects .gitignore and excludes workspace layout churn", async () => {
    write(".gitignore", "ignored/\n");
    write("ignored/secret.txt", "not backed up");
    write(".obsidian/workspace.json", "{}");
    write(".obsidian/workspace-mobile.json", "{}");
    write(".obsidian/app.json", "{}");
    write("note.md", "note");
    await manager.enableVault("v1", vaultPath);

    const files = await repositoryGit("ls-tree", "-r", "--name-only", "HEAD");
    expect(files.trim().split("\n")).toEqual([
      ".gitignore",
      ".obsidian/app.json",
      "note.md",
    ]);

    write(".obsidian/workspace.json", "{\"changed\":true}");
    expect((await manager.backup("v1")).committed).toBe(false);
  });

  it("does not change an existing vault repository or its staged content", async () => {
    await runGit(["init", "--template="], vaultPath);
    write("note.md", "staged content");
    await runGit(["add", "note.md"], vaultPath);
    write("note.md", "current content");
    await manager.enableVault("v1", vaultPath);

    const { stdout } = await runGit(["show", ":note.md"], vaultPath);
    expect(stdout).toBe("staged content");
    expect(await repositoryGit("show", "HEAD:note.md")).toBe("current content");
    expect(await repositoryGit("ls-tree", "-r", "--name-only", "HEAD")).toBe(
      "note.md\n",
    );
  });

  it("handles an empty vault and backs up its first file later", async () => {
    await manager.enableVault("v1", vaultPath);
    expect(manager.getState("v1").status).toBe("idle");
    expect(manager.getState("v1").lastCommit).toBeNull();

    write("note.md", "first content");
    expect((await manager.backup("v1")).committed).toBe(true);
    expect(manager.getState("v1").lastCommit).toMatch(/^[a-f0-9]{40,64}$/);
  });

  it("keeps settings and history across disabling and server restarts", async () => {
    write("note.md", "content");
    await manager.enableVault("v1", vaultPath);
    const commit = manager.getState("v1").lastCommit;
    await manager.configureVault("v1", 300);
    await repositoryGit("pack-refs", "--all");
    await manager.shutdown();

    manager = new BackupManager(ctx);
    await manager.enableVault("v1", vaultPath);
    expect(manager.getState("v1")).toMatchObject({
      intervalSeconds: 300,
      lastCommit: commit,
      status: "idle",
    });
    expect(await repositoryGit("rev-list", "--count", "HEAD")).toBe("1\n");
  });

  it("does not commit mass deletions when a vault is renamed or removed", async () => {
    write("note.md", "content");
    await manager.enableVault("v1", vaultPath);
    const commit = manager.getState("v1").lastCommit;
    ctx.config.getVaultPath = () => null;

    await expect(manager.backup("v1")).rejects.toMatchObject({ code: "ENOENT" });
    expect(manager.getState("v1").lastCommit).toBe(commit);
    expect(await repositoryGit("show", "HEAD:note.md")).toBe("content");

    ctx.config.getVaultPath = () => vaultPath;
    fs.rmSync(vaultPath, { recursive: true });
    await expect(manager.backup("v1")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await repositoryGit("rev-list", "--count", "HEAD")).toBe("1\n");
  });

  it("reports a failure without exposing subprocess output and allows retry", async () => {
    write("note.md", "content");
    vi.spyOn(manager.git, "initialize").mockRejectedValueOnce(
      Object.assign(new Error("/private/path: failed"), { code: "EACCES" }),
    );
    await manager.enableVault("v1", vaultPath);
    expect(manager.getState("v1")).toMatchObject({
      status: "error",
      error: "EACCES",
      lastCommit: null,
    });

    expect((await manager.backup("v1")).committed).toBe(true);
    expect(manager.getState("v1")).toMatchObject({ status: "idle", error: null });
  });

  it("isolates vault histories", async () => {
    const other = path.join(root, "other");
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, "other.md"), "other");
    ctx.config.getVaultPath = (id) => (id === "v1" ? vaultPath : other);
    write("note.md", "content");
    await manager.enableVault("v1", vaultPath);
    await manager.enableVault("v2", other);

    expect(manager.getState("v1").lastCommit).not.toBe(
      manager.getState("v2").lastCommit,
    );
    expect(await repositoryGit("ls-tree", "-r", "--name-only", "HEAD")).toBe(
      "note.md\n",
    );
  });

  it("rejects backup storage inside a vault", async () => {
    ctx.dataDir = path.join(vaultPath, "data");
    fs.mkdirSync(ctx.dataDir);
    await expect(manager.enableVault("v1", vaultPath)).rejects.toMatchObject({
      code: "BACKUP_DATA_IN_VAULT",
    });
    expect(manager.getState("v1")).toBeNull();
  });
});

describe("background backup lifecycle", () => {
  it("shares concurrent enable requests and stops an initializing vault", async () => {
    vi.useFakeTimers();
    let finish;
    const snapshot = vi.spyOn(manager, "createSnapshot").mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const enabling = manager.enableVault("v1", vaultPath);
    expect(manager.enableVault("v1", vaultPath)).toBe(enabling);
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));

    const shutdown = manager.shutdown();
    finish(false);
    await enabling;
    await shutdown;
    expect(manager.getState("v1")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs on the interval without a browser watcher and stops when disabled", async () => {
    vi.useFakeTimers();
    const snapshot = vi.spyOn(manager, "createSnapshot").mockResolvedValue(false);
    await manager.enableVault("v1", vaultPath);
    expect(snapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(snapshot).toHaveBeenCalledTimes(2);
    await manager.configureVault("v1", 10);
    await vi.advanceTimersByTimeAsync(10000);
    expect(snapshot).toHaveBeenCalledTimes(3);

    await manager.disableVault("v1");
    await vi.advanceTimersByTimeAsync(120000);
    expect(snapshot).toHaveBeenCalledTimes(3);
  });

  it("coalesces overlapping requests and waits for the active backup on shutdown", async () => {
    vi.useFakeTimers();
    vi.spyOn(manager, "createSnapshot").mockResolvedValue(false);
    await manager.enableVault("v1", vaultPath);
    let finish;
    manager.createSnapshot.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = manager.backup("v1");
    expect(manager.backup("v1")).toBe(first);
    const shutdown = manager.shutdown();
    expect(manager.getState("v1").status).toBe("running");
    finish(true);
    await first;
    await shutdown;
    expect(manager.getState("v1")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 9, 3601, 1.5, "60", null])(
    "rejects invalid interval %s",
    async (value) => {
      await expect(manager.configureVault("v1", value)).rejects.toThrow(
        "intervalSeconds",
      );
    },
  );
});
