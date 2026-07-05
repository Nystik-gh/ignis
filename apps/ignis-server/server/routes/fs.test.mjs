import path from "path";
import fs from "node:fs";
import os from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  resolveVaultPath,
  encodeContentDispositionFilename,
} = require("@ignis/server-core");

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

  it("returns null for null input", () => {
    expect(resolveVaultPath(root, null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(resolveVaultPath(root, undefined)).toBe(null);
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

  it("does not false-reject a vault based at the filesystem root", () => {
    const fsRoot = path.parse(process.cwd()).root;
    expect(resolveVaultPath(fsRoot, "child/leaf.md")).toBe(
      path.resolve(fsRoot, "child/leaf.md"),
    );
  });
});

// -- resolveVaultPath symlink guard (filesystem) ---------------------

// Symlink creation needs privilege or Developer Mode on Windows; skip those cases where it fails.
let canSymlink = false;
try {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-symlink-probe-"));
  fs.symlinkSync(probe, path.join(probe, "l"), "dir");
  canSymlink = true;
  fs.rmSync(probe, { recursive: true, force: true });
} catch {
  canSymlink = false;
}

describe("resolveVaultPath symlink guard", () => {
  let vault;
  let outside;

  beforeAll(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-vault-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-outside-"));
    fs.mkdirSync(path.join(vault, "notes"));
    fs.writeFileSync(path.join(vault, "notes", "a.md"), "a");
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");

    if (canSymlink) {
      fs.symlinkSync(
        path.join(outside, "secret.txt"),
        path.join(vault, "escape"),
        "file",
      );
      fs.symlinkSync(outside, path.join(vault, "escapedir"), "dir");
      fs.symlinkSync(path.join(vault, "notes"), path.join(vault, "notelink"), "dir");
      fs.symlinkSync(
        path.join(outside, "newfile.txt"),
        path.join(vault, "dangleout"),
        "file",
      );
    }
  });

  afterAll(() => {
    for (const d of [vault, outside]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("allows a normal path inside the vault", () => {
    expect(resolveVaultPath(vault, "notes/a.md")).toBe(
      path.join(vault, "notes", "a.md"),
    );
  });

  it("allows creating a new file inside the vault", () => {
    expect(resolveVaultPath(vault, "notes/new.md")).toBe(
      path.join(vault, "notes", "new.md"),
    );
  });

  it.skipIf(!canSymlink)(
    "rejects a symlink pointing to a file outside the vault",
    () => {
      expect(resolveVaultPath(vault, "escape")).toBe(null);
    },
  );

  it.skipIf(!canSymlink)(
    "rejects a directory symlink pointing outside the vault",
    () => {
      expect(resolveVaultPath(vault, "escapedir")).toBe(null);
      expect(resolveVaultPath(vault, "escapedir/secret.txt")).toBe(null);
    },
  );

  it.skipIf(!canSymlink)(
    "rejects a dangling symlink pointing outside the vault",
    () => {
      expect(resolveVaultPath(vault, "dangleout")).toBe(null);
    },
  );

  it.skipIf(!canSymlink)("allows an intra-vault symlink", () => {
    expect(resolveVaultPath(vault, "notelink/a.md")).toBe(
      path.join(vault, "notelink", "a.md"),
    );
  });
});
