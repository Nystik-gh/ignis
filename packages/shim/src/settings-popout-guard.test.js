import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// settings-popout-guard.js reads the vault app config through the fs shim at
// init time only; the registered transforms are pure and testable in isolation.
const fsShimMock = {
  readFileSync: vi.fn(),
};
vi.mock("./fs/index.js", () => ({
  fsShim: fsShimMock,
}));

// patchSetConfig inside init() walks window.app.vault.setConfig and replaces
// it with a wrapper; only transform behaviour is asserted here.
const realSetConfig = vi.fn();
const fakeVault = { setConfig: realSetConfig };
vi.stubGlobal("window", { app: { vault: fakeVault } });
vi.stubGlobal("document", { documentElement: {} });
vi.stubGlobal("MutationObserver", class {});

const { applyReadTransform, applyWriteTransform, _reset } = await import(
  "./fs/transforms.js"
);
const { initSettingsPopoutGuard } = await import("./settings-popout-guard.js");

// Each test starts from a fresh guard: no on-disk settingsPopoutWindow value.
beforeEach(() => {
  fsShimMock.readFileSync.mockReturnValue(JSON.stringify({}));
  initSettingsPopoutGuard();
});

afterEach(() => {
  _reset();
});

describe("settings-popout-guard read transform", () => {
  it("forces settingsPopoutWindow to false on read when set to true", () => {
    const input = JSON.stringify({ settingsPopoutWindow: true });
    const out = applyReadTransform(".obsidian/app.json", input);
    expect(JSON.parse(out).settingsPopoutWindow).toBe(false);
  });

  it("leaves settingsPopoutWindow false untouched on read", () => {
    const input = JSON.stringify({ settingsPopoutWindow: false, other: 1 });
    const out = applyReadTransform(".obsidian/app.json", input);
    expect(JSON.parse(out)).toEqual({ settingsPopoutWindow: false, other: 1 });
  });

  it("leaves non-app.json reads untouched", () => {
    const input = JSON.stringify({ settingsPopoutWindow: true });
    expect(applyReadTransform("notes/foo.md", input)).toBe(input);
  });
});

describe("settings-popout-guard write transform", () => {
  it("strips settingsPopoutWindow when it was absent on disk", () => {
    // No on-disk value: a write must not persist the runtime-forced false.
    const input = JSON.stringify({ settingsPopoutWindow: false });
    const out = applyWriteTransform(".obsidian/app.json", input);
    expect(JSON.parse(out)).toEqual({});
  });

  it("preserves the on-disk value when the key was present", () => {
    // Re-init the guard with settingsPopoutWindow true on disk; a write must
    // restore true instead of persisting the forced false.
    fsShimMock.readFileSync.mockReturnValue(
      JSON.stringify({ settingsPopoutWindow: true }),
    );
    _reset();
    initSettingsPopoutGuard();

    const input = JSON.stringify({ settingsPopoutWindow: false });
    const out = applyWriteTransform(".obsidian/app.json", input);
    expect(JSON.parse(out).settingsPopoutWindow).toBe(true);
  });
});
