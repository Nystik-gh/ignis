import { describe, it, expect, vi, afterEach } from "vitest";

// ipc-renderer's sendSync routes to syncHandlers; the module top-level only
// references window inside the handlers, so stub window and console.
vi.stubGlobal("window", {
  __currentVaultId: "local-ob",
  __vaultConfig: { id: "local-ob", path: "/" },
  __obsidianVersion: "1.13.7",
  __vaultList: [{ id: "local-ob" }],
  open: vi.fn(),
});
vi.stubGlobal("console", { log: vi.fn(), warn: vi.fn(), error: vi.fn() });

const { ipcRenderer } = await import("./ipc-renderer.js");

const TERMS_STRING =
  "I understand and agree that I am not allowed to distribute the Obsidian application, in any form, without explicit approval from the Obsidian team. I also understand that Obsidian is a registered trademark, and I cannot use it without explicit permission granted by the Obsidian team.";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Obsidian 1.13.x startup channels", () => {
  it("terms returns the exact license string Obsidian checks at startup", () => {
    // A mismatch makes Obsidian call window.close() and abort with a blank page.
    expect(ipcRenderer.sendSync("terms")).toBe(TERMS_STRING);
  });

  it("policy returns an empty object that Obsidian freezes for permission lookups", () => {
    // Obsidian calls Object.freeze() on the return value itself.
    const policy = ipcRenderer.sendSync("policy");
    expect(typeof policy).toBe("object");
    expect(policy).toEqual({});
    expect(() => Object.freeze(policy)).not.toThrow();
  });

  it("is-closing and is-quitting report false so the tab can close", () => {
    expect(ipcRenderer.sendSync("is-closing")).toBe(false);
    expect(ipcRenderer.sendSync("is-quitting")).toBe(false);
  });

  it("adblock channels return an empty list and zero frequency", () => {
    expect(ipcRenderer.sendSync("adblock-lists")).toEqual([]);
    expect(ipcRenderer.sendSync("adblock-frequency")).toBe(0);
  });
});

describe("existing channels still work", () => {
  it("version reports the running Obsidian version", () => {
    expect(ipcRenderer.sendSync("version")).toBe("1.13.7");
  });

  it("vault reports the current vault config", () => {
    expect(ipcRenderer.sendSync("vault")).toMatchObject({
      id: "local-ob",
      path: "/",
    });
  });

  it("file-url returns the /vault-files/ prefix", () => {
    expect(ipcRenderer.sendSync("file-url")).toBe("/vault-files/local-ob/");
  });

  it("unknown channels return null instead of throwing", () => {
    expect(ipcRenderer.sendSync("no-such-channel")).toBeNull();
  });
});
