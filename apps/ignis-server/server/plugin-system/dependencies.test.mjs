import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { DependencyManager } = require("./dependencies");
const DEPENDENCY = { name: "test-runtime", version: "1.2.3" };
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-dependencies-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function installFixture(directory, dependency) {
  const packageDir = path.join(directory, "node_modules", dependency.name);
  await fs.promises.mkdir(packageDir, { recursive: true });
  await fs.promises.writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    name: dependency.name,
    version: dependency.version,
    main: "index.js",
  }));
  await fs.promises.writeFile(path.join(packageDir, "index.js"),
    `module.exports = ${JSON.stringify(dependency.version)};`,
  );
}

describe("plugin dependency cache", () => {
  it("does not install anything until a dependency is requested", () => {
    const install = vi.fn();
    const manager = new DependencyManager(root, { install });
    expect(manager.resolveCached(DEPENDENCY)).toBeNull();
    expect(fs.existsSync(manager.root)).toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the exact version in data and exposes only declared modules", async () => {
    const install = vi.fn(installFixture);
    const manager = new DependencyManager(root, { install });
    const prepared = await manager.prepare([DEPENDENCY]);
    const directory = manager.directoryFor(DEPENDENCY);
    expect(install).toHaveBeenCalledOnce();
    expect(prepared.require(DEPENDENCY.name)).toBe("1.2.3");
    expect(prepared.resolve(DEPENDENCY.name)).toContain(directory);
    expect(() => prepared.require("undeclared")).toThrow("Undeclared");
    expect(JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf-8"))).toEqual({
      private: true, dependencies: { "test-runtime": "1.2.3" },
    });
  });

  it("reuses installed dependencies after restart without network or npm", async () => {
    await new DependencyManager(root, { install: installFixture }).prepare([DEPENDENCY]);
    const install = vi.fn(() => { throw new Error("Offline"); });
    const restarted = new DependencyManager(root, { install });
    const prepared = await restarted.prepare([DEPENDENCY]);
    expect(prepared.require(DEPENDENCY.name)).toBe("1.2.3");
    expect(install).not.toHaveBeenCalled();
  });

  it("shares concurrent installs across plugins and manager instances", async () => {
    let finish;
    const waiting = new Promise((resolve) => { finish = resolve; });
    const install = vi.fn(async (directory, dependency) => {
      await waiting;
      await installFixture(directory, dependency);
    });
    const first = new DependencyManager(root, { install }).ensure(DEPENDENCY);
    const second = new DependencyManager(root, { install }).ensure(DEPENDENCY);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    finish();
    expect(await first).toBe(await second);
  });

  it("isolates different versions and scoped packages", async () => {
    const manager = new DependencyManager(root, { install: installFixture });
    const other = { ...DEPENDENCY, version: "2.0.0" };
    const scoped = { name: "@ignis-test/runtime", version: "1.0.0" };
    const first = await manager.prepare([DEPENDENCY, scoped]);
    const second = await manager.prepare([other]);
    expect(first.require(DEPENDENCY.name)).toBe("1.2.3");
    expect(second.require(DEPENDENCY.name)).toBe("2.0.0");
    expect(first.require(scoped.name)).toBe("1.0.0");
    expect(first.resolve(DEPENDENCY.name)).not.toBe(second.resolve(DEPENDENCY.name));
  });

  it("keeps native installs separate by runtime and script policy", () => {
    const manager = new DependencyManager(root);
    expect(manager.directoryFor(DEPENDENCY)).toContain(
      `${process.platform}-${process.arch}-${process.versions.modules}`,
    );
    expect(manager.directoryFor({ ...DEPENDENCY, installScripts: true }))
      .not.toBe(manager.directoryFor(DEPENDENCY));
  });

  it("retries a failed installation instead of accepting a partial package", async () => {
    const install = vi.fn(async (directory, dependency) => {
      await installFixture(directory, dependency);
      throw new Error("Download interrupted");
    });
    const manager = new DependencyManager(root, { install });
    await expect(manager.ensure(DEPENDENCY)).rejects.toMatchObject({
      code: "PLUGIN_DEPENDENCY_INSTALL_FAILED",
    });
    expect(manager.resolveCached(DEPENDENCY)).toBeNull();
    install.mockImplementation(installFixture);
    await manager.ensure(DEPENDENCY);
    expect(install).toHaveBeenCalledTimes(2);
    expect(manager.resolveCached(DEPENDENCY)).not.toBeNull();
  });

  it("rejects a package installed at the wrong version", async () => {
    const manager = new DependencyManager(root, {
      install: (directory, dependency) => installFixture(directory, { ...dependency, version: "9.0.0" }),
    });
    await expect(manager.ensure(DEPENDENCY)).rejects.toMatchObject({
      code: "PLUGIN_DEPENDENCY_INSTALL_FAILED",
    });
    expect(manager.resolveCached(DEPENDENCY)).toBeNull();
  });

  it.each([
    { name: "../escape", version: "1.0.0" },
    { name: "https://example.test/package", version: "1.0.0" },
    { name: "test-runtime", version: "latest" },
    { name: "test-runtime", version: "^1.0.0" },
    { name: "test-runtime", version: "1.0.0", installScripts: "true" },
  ])("rejects invalid declarations before installing: %j", async (dependency) => {
    const install = vi.fn();
    const manager = new DependencyManager(root, { install });
    await expect(manager.prepare([DEPENDENCY, dependency])).rejects.toMatchObject({
      code: "INVALID_PLUGIN_DEPENDENCY",
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("rejects duplicate declarations before starting an install", async () => {
    const install = vi.fn();
    const manager = new DependencyManager(root, { install });
    await expect(manager.prepare([DEPENDENCY, DEPENDENCY])).rejects.toMatchObject({
      code: "INVALID_PLUGIN_DEPENDENCY",
    });
    expect(install).not.toHaveBeenCalled();
  });
});
