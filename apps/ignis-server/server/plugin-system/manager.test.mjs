import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const express = require("express");
const discovery = require("./discovery");
const { DependencyManager } = require("./dependencies");

let root;
let manager;
let plugin;
let wss;
let prepare;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-plugin-manager-"));
  plugin = {
    id: "test-plugin",
    name: "Test Plugin",
    dependencies: [{ name: "test-runtime", version: "1.0.0" }],
    register: vi.fn(),
    shutdown: vi.fn(),
    onVaultEnabled: vi.fn(),
    onVaultDisabled: vi.fn(),
  };
  wss = { broadcastToVault: vi.fn() };
  prepare = vi.spyOn(DependencyManager.prototype, "prepare")
    .mockResolvedValue({ resolve: vi.fn(), require: vi.fn() });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(discovery, "discoverPlugins").mockReturnValue(new Map([
    [plugin.id, {
      ...plugin,
      module: plugin,
      obsidianPlugin: "companion",
      bundledPluginId: "ignis-test-plugin",
      bundledManifest: { id: "ignis-test-plugin" },
    }],
  ]));
  delete require.cache[require.resolve("./manager")];
  manager = require("./manager");
  await manager.initPlugins({
    app: express(),
    config: {
      dataRoot: root,
      getVaultPath: (id) => ["v1", "v2"].includes(id) ? path.join(root, id) : null,
    },
    wss,
  });
});

afterEach(async () => {
  await manager.shutdownPlugins();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("plugin dependency lifecycle", () => {
  it("discovers disabled plugins without preparing dependencies", () => {
    expect(prepare).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it("does not mark a plugin enabled when installation fails", async () => {
    prepare.mockRejectedValueOnce(Object.assign(new Error("Offline"), {
      code: "PLUGIN_DEPENDENCY_INSTALL_FAILED",
    }));
    await expect(manager.enablePluginForVault(plugin.id, "v1")).rejects.toMatchObject({
      code: "PLUGIN_DEPENDENCY_INSTALL_FAILED",
    });
    expect(manager.getDiscoveredPlugins()[0]).toMatchObject({
      enabledVaults: [], loaded: false,
    });
    expect(fs.existsSync(path.join(root, "plugin-config.json"))).toBe(false);
    expect(plugin.register).not.toHaveBeenCalled();
    expect(wss.broadcastToVault).not.toHaveBeenCalled();
  });

  it("passes dependencies to register before enabling the companion", async () => {
    await manager.enablePluginForVault(plugin.id, "v1");
    expect(prepare).toHaveBeenCalledWith(plugin.dependencies);
    expect(plugin.register.mock.calls[0][0].dependencies).toHaveProperty("resolve");
    expect(manager.getDiscoveredPlugins()[0].enabledVaults).toEqual(["v1"]);
    expect(wss.broadcastToVault).toHaveBeenCalledWith("v1", expect.objectContaining({
      type: "virtual-plugin-enable",
    }));
  });

  it("serializes concurrent enables so a plugin registers once", async () => {
    await Promise.all([
      manager.enablePluginForVault(plugin.id, "v1"),
      manager.enablePluginForVault(plugin.id, "v2"),
    ]);
    expect(plugin.register).toHaveBeenCalledOnce();
    expect(plugin.onVaultEnabled).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "plugin-config.json"), "utf-8"));
    expect(saved[plugin.id].enabledVaults).toEqual(["v1", "v2"]);
  });

  it("rolls back a failed vault hook and allows a later retry", async () => {
    plugin.onVaultEnabled.mockRejectedValueOnce(new Error("Cannot start"));
    await expect(manager.enablePluginForVault(plugin.id, "v1")).rejects.toThrow("Cannot start");
    expect(manager.getDiscoveredPlugins()[0]).toMatchObject({ enabledVaults: [], loaded: false });
    expect(plugin.shutdown).toHaveBeenCalledOnce();
    await manager.enablePluginForVault(plugin.id, "v1");
    expect(manager.getDiscoveredPlugins()[0].enabledVaults).toEqual(["v1"]);
  });

  it("cleans up a register failure before retrying", async () => {
    plugin.register.mockRejectedValueOnce(new Error("Cannot register"));
    await expect(manager.enablePluginForVault(plugin.id, "v1"))
      .rejects.toThrow("Cannot register");
    expect(plugin.shutdown).toHaveBeenCalledOnce();
    expect(manager.getDiscoveredPlugins()[0])
      .toMatchObject({ enabledVaults: [], loaded: false });
    await manager.enablePluginForVault(plugin.id, "v1");
    expect(plugin.register).toHaveBeenCalledTimes(2);
  });
});
