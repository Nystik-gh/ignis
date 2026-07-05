import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "./clipboard.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a textarea + execCommand when clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const ta = { style: {}, value: "", select: vi.fn() };
    const removeChild = vi.fn();
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn(), removeChild },
      execCommand,
    });

    await expect(copyText("hello")).resolves.toBeUndefined();

    expect(ta.value).toBe("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(removeChild).toHaveBeenCalledWith(ta);
  });

  it("rejects when the fallback copy command fails", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, value: "", select: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => false,
    });

    await expect(copyText("x")).rejects.toThrow("copy command rejected");
  });
});
