import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const express = require("express");
const { mountRoutes } = require("./routes");

const manager = {
  getState: vi.fn(),
  configureVault: vi.fn(),
  backup: vi.fn(),
};
const ctx = {
  config: {
    getVaultPath: (id) =>
      ["enabled", "disabled"].includes(id) ? "/vault" : null,
  },
  getEnabledVaults: () => ["enabled"],
};
let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountRoutes(router, {
    getCtx: () => ctx,
    getGitStatus: () => ({ installed: true, version: "git version test" }),
    getBackupManager: () => manager,
  });
  app.use("/api/ext/git-backup", router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/ext/git-backup`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.resetAllMocks();
  manager.getState.mockReturnValue({ vaultId: "enabled", status: "idle" });
});

function post(route, body) {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Git Backup routes", () => {
  it("returns Git availability and the enabled vault's state", async () => {
    const response = await fetch(`${base}/status?vaultId=enabled`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      installed: true,
      state: { vaultId: "enabled", status: "idle" },
    });
  });

  it.each([
    [{}, 400],
    [{ vaultId: ["enabled"] }, 400],
    [{ vaultId: "unknown" }, 404],
    [{ vaultId: "disabled" }, 403],
  ])("rejects backup requests for unavailable vaults: %j", async (body, status) => {
    const response = await post("/backup", body);
    expect(response.status).toBe(status);
    expect(manager.backup).not.toHaveBeenCalled();
  });

  it("also scopes status and configuration to enabled vaults", async () => {
    expect((await fetch(`${base}/status?vaultId=disabled`)).status).toBe(403);
    const response = await post("/config", {
      vaultId: "disabled",
      intervalSeconds: 60,
    });
    expect(response.status).toBe(403);
    expect(manager.getState).not.toHaveBeenCalled();
    expect(manager.configureVault).not.toHaveBeenCalled();
  });

  it.each([9, 3601, 10.5, "60", null])(
    "rejects invalid interval %s before persisting",
    async (intervalSeconds) => {
      const response = await post("/config", {
        vaultId: "enabled",
        intervalSeconds,
      });
      expect(response.status).toBe(400);
      expect(manager.configureVault).not.toHaveBeenCalled();
    },
  );

  it("saves the requested interval and returns the updated state", async () => {
    manager.configureVault.mockResolvedValue({ intervalSeconds: 300 });
    const response = await post("/config", {
      vaultId: "enabled",
      intervalSeconds: 300,
    });
    expect(response.status).toBe(200);
    expect(manager.configureVault).toHaveBeenCalledWith("enabled", 300);
    expect(await response.json()).toEqual({
      success: true,
      state: { intervalSeconds: 300 },
    });
  });

  it("reports whether a manual backup committed changes", async () => {
    manager.backup.mockResolvedValue({
      committed: false,
      state: { status: "idle" },
    });
    const response = await post("/backup", { vaultId: "enabled" });
    expect(response.status).toBe(200);
    expect(manager.backup).toHaveBeenCalledWith("enabled");
    expect(await response.json()).toEqual({
      success: true,
      committed: false,
      state: { status: "idle" },
    });
  });

  it("does not expose Git subprocess errors or server paths", async () => {
    manager.backup.mockRejectedValue(
      Object.assign(new Error("git failed at /private/data/repository.git"), {
        code: 128,
      }),
    );
    const response = await post("/backup", { vaultId: "enabled" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 128, code: 128 });
  });
});
