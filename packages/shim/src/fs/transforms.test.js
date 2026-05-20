import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPathResolver,
  resolvePath,
  registerReadTransform,
  applyReadTransform,
  registerWriteTransform,
  applyWriteTransform,
  _reset,
} from "./transforms.js";

beforeEach(() => {
  _reset();
});

describe("resolvePath", () => {
  it("returns the resolved path when a matcher hits", () => {
    registerPathResolver(
      (p) => p === ".obsidian/workspace.json",
      () => ".obsidian/workspace.default.json",
    );

    expect(resolvePath(".obsidian/workspace.json")).toBe(
      ".obsidian/workspace.default.json",
    );
  });

  it("returns the input path when no matcher hits", () => {
    registerPathResolver(
      (p) => p === ".obsidian/workspace.json",
      () => ".obsidian/workspace.default.json",
    );

    expect(resolvePath("notes/foo.md")).toBe("notes/foo.md");
  });
});

describe("applyReadTransform", () => {
  it("applies a registered transform when the path matches", () => {
    registerReadTransform(".obsidian/core-plugins.json", (data) =>
      data.replace('"sync":true', '"sync":false'),
    );

    const input = '{"sync":true,"foo":1}';
    expect(applyReadTransform(".obsidian/core-plugins.json", input)).toBe(
      '{"sync":false,"foo":1}',
    );
  });

  it("returns data unchanged when no transform is registered for the path", () => {
    registerReadTransform(".obsidian/core-plugins.json", (data) =>
      data.replace('"sync":true', '"sync":false'),
    );

    const input = '{"sync":true}';
    expect(applyReadTransform("notes/foo.md", input)).toBe(input);
  });
});

describe("applyWriteTransform", () => {
  it("applies a registered transform when the path matches", () => {
    registerWriteTransform(".obsidian/workspaces.json", (data) =>
      data.replace('"active":"w2"', '"active":"default"'),
    );

    const input = '{"active":"w2"}';
    expect(applyWriteTransform(".obsidian/workspaces.json", input)).toBe(
      '{"active":"default"}',
    );
  });
});

describe("path normalization", () => {
  it("matches a path registered with one separator form against lookups in another", () => {
    registerReadTransform(".obsidian/foo.json", (data) => `seen:${data}`);

    expect(applyReadTransform(".obsidian\\foo.json", "x")).toBe("seen:x");
    expect(applyReadTransform("/.obsidian/foo.json", "x")).toBe("seen:x");
  });
});
