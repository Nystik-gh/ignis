import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./fs/virtual-files.js", () => ({
  setVirtualFile: vi.fn(),
  removeVirtualFile: vi.fn(),
}));
vi.mock("./require.js", () => ({ registerShim: vi.fn() }));

import { extractObsidianModule } from "./virtual-plugin-loader.js";
import { registerShim } from "./require.js";

const EXTRACTOR_ID = "ignis-obsidian-extractor";

function makePlugins({ communityOn = false, loadThrows = false } = {}) {
  const proto = {
    isEnabled: () => communityOn,
    setEnable: vi.fn(async () => {}),
    loadPlugin: vi.fn(async function (id) {
      if (!this.isEnabled()) {
        return;
      }

      if (loadThrows) {
        throw new Error("boom");
      }

      if (id === EXTRACTOR_ID) {
        window.__ignisCapturedObsidian = { Plugin: class {}, __captured: true };
      }

      this.plugins[id] = {};
    }),
    unloadPlugin: vi.fn(async function (id) {
      delete this.plugins[id];
    }),
  };

  return Object.assign(Object.create(proto), {
    manifests: {},
    plugins: {},
    enabledPlugins: new Set(["dataview"]),
  });
}

function installApp(plugins, { layoutReady = true } = {}) {
  const pending = [];
  const workspace = {
    onLayoutReady: vi.fn((cb) => (layoutReady ? cb() : pending.push(cb))),
    fireLayoutReady: () => pending.splice(0).forEach((cb) => cb()),
  };

  globalThis.window = { __ignis: {}, app: { plugins, workspace } };
  globalThis.localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };

  return workspace;
}

describe("extractObsidianModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it("captures the module on a restricted vault without enabling community plugins or writing the trust key", async () => {
    const plugins = makePlugins({ communityOn: false });
    installApp(plugins);

    const captured = await extractObsidianModule();

    expect(captured.__captured).toBe(true);
    expect(window.__ignis.obsidian).toBe(captured);
    expect(registerShim).toHaveBeenCalledWith("obsidian", captured);

    expect(plugins.setEnable).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();

    expect(plugins.loadPlugin).toHaveBeenCalledTimes(1);
    expect(plugins.loadPlugin).toHaveBeenCalledWith(EXTRACTOR_ID);
    expect(Object.keys(plugins.plugins)).toEqual([]);
    expect(plugins.manifests[EXTRACTOR_ID]).toBeUndefined();
  });

  it("removes the isEnabled override afterwards", async () => {
    const plugins = makePlugins({ communityOn: false });
    installApp(plugins);

    await extractObsidianModule();

    expect(Object.prototype.hasOwnProperty.call(plugins, "isEnabled")).toBe(
      false,
    );
    expect(plugins.isEnabled()).toBe(false);
  });

  it("removes the override when the probe fails to load, and returns null", async () => {
    const plugins = makePlugins({ communityOn: false, loadThrows: true });
    installApp(plugins);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const captured = await extractObsidianModule();

    expect(captured).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(plugins, "isEnabled")).toBe(
      false,
    );
    expect(plugins.setEnable).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("captures on a trusted vault the same way", async () => {
    const plugins = makePlugins({ communityOn: true });
    installApp(plugins);

    const captured = await extractObsidianModule();

    expect(captured.__captured).toBe(true);
    expect(plugins.setEnable).not.toHaveBeenCalled();
    expect(plugins.isEnabled()).toBe(true);
  });

  it("does not load the probe until the workspace layout is ready", async () => {
    const plugins = makePlugins({ communityOn: false });
    const workspace = installApp(plugins, { layoutReady: false });

    const extraction = extractObsidianModule();
    await Promise.resolve();

    expect(workspace.onLayoutReady).toHaveBeenCalledTimes(1);
    expect(plugins.loadPlugin).not.toHaveBeenCalled();

    workspace.fireLayoutReady();
    const captured = await extraction;

    expect(captured.__captured).toBe(true);
  });
});

describe("loadVirtualPlugin", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.fetch;
    delete globalThis.location;
  });

  it("announces the load on the window once the plugin is registered", async () => {
    const { loadVirtualPlugin } = await import("./virtual-plugin-loader.js");
    const dispatched = [];

    globalThis.window = {
      __ignis: { obsidian: {} },
      app: {},
      dispatchEvent: (event) => {
        dispatched.push({
          type: event.type,
          id: event.detail.id,
          registered: Boolean(window.__ignis.plugins["ignis-demo"]),
        });
      },
    };
    globalThis.location = { origin: "http://ignis.test" };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () =>
        "module.exports = class { constructor() {} async onload() {} };",
    }));

    await loadVirtualPlugin({
      id: "ignis-demo",
      scriptUrl: "/ignis-demo.js",
      manifest: { id: "ignis-demo" },
    });

    expect(dispatched).toEqual([
      {
        type: "ignis:virtual-plugin-loaded",
        id: "ignis-demo",
        registered: true,
      },
    ]);
  });
});
