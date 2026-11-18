import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Buffer as PackageBuffer } from "buffer/";
import { installBuffer } from "./buffer.js";

let Buffer;

beforeEach(() => {
  const win = {};

  vi.stubGlobal("window", win);
  installBuffer();
  Buffer = win.Buffer;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installBuffer", () => {
  it("installs the buffer package's Buffer", () => {
    expect(Buffer).toBe(PackageBuffer);
    expect(Buffer).not.toBe(globalThis.Buffer);
  });
});
