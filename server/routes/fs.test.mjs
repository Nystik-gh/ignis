import path from "path";
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  resolveVaultPath,
  encodeContentDispositionFilename,
} = require("./fs.js");

// -- encodeContentDispositionFilename --------------------------------

describe("encodeContentDispositionFilename", () => {
  it("handles a plain ASCII filename", () => {
    expect(encodeContentDispositionFilename("report.pdf")).toBe(
      'attachment; filename="report.pdf"',
    );
  });

  it("preserves spaces in quotes", () => {
    expect(encodeContentDispositionFilename("my report.pdf")).toBe(
      'attachment; filename="my report.pdf"',
    );
  });

  it("escapes double quotes", () => {
    const result = encodeContentDispositionFilename('file"name.txt');
    expect(result).toBe('attachment; filename="file\\"name.txt"');
  });

  it("escapes backslashes", () => {
    const result = encodeContentDispositionFilename("path\\to\\file.txt");
    expect(result).toBe('attachment; filename="path\\\\to\\\\file.txt"');
  });

  it("produces ASCII fallback and filename* for unicode", () => {
    const result = encodeContentDispositionFilename(
      "\u65E5\u672C\u8A9Enotes.md",
    );
    expect(result).toContain('filename="___notes.md"');
    expect(result).toContain("filename*=UTF-8''");
    expect(result).toContain("%E6%97%A5");
  });

  it("replaces only non-ASCII in the fallback for mixed filenames", () => {
    const result = encodeContentDispositionFilename("report_2024\u5E74.pdf");
    expect(result).toContain('filename="report_2024_.pdf"');
    expect(result).toContain("filename*=UTF-8''");
  });

  it("strips control characters", () => {
    const result = encodeContentDispositionFilename("bad\x00file\x1F.txt");
    expect(result).toBe('attachment; filename="badfile.txt"');
  });

  it("does not crash on empty string", () => {
    const result = encodeContentDispositionFilename("");
    expect(result).toBe('attachment; filename=""');
  });
});

// -- resolveVaultPath ------------------------------------------------

describe("resolveVaultPath", () => {
  const root = "/vaults/test";

  it("resolves a simple relative path", () => {
    const result = resolveVaultPath(root, "notes/daily.md");
    expect(result).toBe(path.resolve(root, "notes/daily.md"));
  });

  it("resolves empty string to vault root", () => {
    expect(resolveVaultPath(root, "")).toBe(path.resolve(root));
  });

  it("allows a path that equals the vault root exactly", () => {
    expect(resolveVaultPath(root, "")).toBe(path.resolve(root));
  });

  it("treats null input as vault root", () => {
    expect(resolveVaultPath(root, null)).toBe(path.resolve(root));
  });

  it("treats undefined input as vault root", () => {
    expect(resolveVaultPath(root, undefined)).toBe(path.resolve(root));
  });

  it("strips leading slashes", () => {
    const result = resolveVaultPath(root, "///notes/daily.md");
    expect(result).toBe(path.resolve(root, "notes/daily.md"));
  });

  it("resolves ./ segments correctly", () => {
    const result = resolveVaultPath(root, "./notes/../notes/daily.md");
    expect(result).toBe(path.resolve(root, "notes/daily.md"));
  });

  it("rejects ../ that escapes vault root", () => {
    expect(resolveVaultPath(root, "../")).toBe(null);
  });

  it("rejects deep traversal", () => {
    expect(resolveVaultPath(root, "a/b/c/../../../../etc/passwd")).toBe(null);
  });

  it("rejects traversal to a sibling vault with a shared prefix", () => {
    expect(resolveVaultPath(root, "../testing/foo")).toBe(null);
  });
});
