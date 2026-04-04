const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const config = require("../config");

const router = express.Router();

/**
 * Encode a filename for use in Content-Disposition header.
 * Handles non-ASCII characters and special characters to prevent header injection.
 * Uses RFC 5987 encoding for filename* parameter when needed.
 *
 * @param {string} filename - The filename to encode
 * @returns {string} - Properly formatted Content-Disposition value
 */
function encodeContentDispositionFilename(filename) {
  // Check if filename contains non-ASCII characters
  const hasNonASCII = /[^\x00-\x7F]/.test(filename);

  // Escape quotes and backslashes in ASCII filename by prefixing with backslash
  const escapedFilename = filename.replace(/["\\ ]/g, function (match) {
    if (match === '"') return '\\"';
    if (match === "\\") return "\\\\";
    return match;
  });

  // Remove any control characters that could cause header injection
  const sanitizedFilename = escapedFilename.replace(/[\x00-\x1F\x7F]/g, "");

  if (!hasNonASCII) {
    // Simple ASCII filename - use standard format
    return `attachment; filename="${sanitizedFilename}"`;
  }

  // Non-ASCII filename - use RFC 5987 encoding
  // Encode using percent-encoding for UTF-8
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    })
    .replace(/\*/g, "%2A");

  // Provide both filename (ASCII fallback) and filename* (UTF-8 encoded)
  // For fallback, replace non-ASCII with underscores
  const asciiFallback = filename
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/["\\ ]/g, function (match) {
      if (match === '"') return '\\"';
      if (match === "\\") return "\\\\";
      return match;
    });

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

// Resolve the vault root for a request. Reads vault ID from query or body.
function getVaultRoot(req, res) {
  const vaultId = req.query.vault || req.body?.vault || config.defaultVaultId;
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    res.status(404).json({ error: "Vault not found", id: vaultId });
    return null;
  }
  return vaultPath;
}

// Resolve a client-provided path to an absolute path within a vault.
// Strips leading slashes so paths from the client are always treated as relative to the vault root.
function resolveVaultPath(vaultRoot, relativePath) {
  const cleaned = (relativePath || "").replace(/^\/+/, "");
  const resolved = path.resolve(vaultRoot, cleaned);

  const resolvedRoot = path.resolve(vaultRoot);

  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
}

function guardPath(req, res, source = "query") {
  const vaultRoot = getVaultRoot(req, res);

  if (!vaultRoot) {
    return null;
  }

  const p = source === "body" ? req.body?.path : req.query.path;

  if (p === undefined || p === null) {
    res.status(400).json({ error: "Missing path parameter" });
    return null;
  }

  // Empty string = vault root, which is valid
  const resolved = resolveVaultPath(vaultRoot, p);

  if (!resolved) {
    res.status(403).json({ error: "Path traversal rejected" });
    return null;
  }

  req._vaultRoot = vaultRoot;
  return resolved;
}

// GET /api/fs/stat?path=...
router.get("/stat", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    const stat = await fs.promises.stat(resolved);

    res.json({
      type: stat.isDirectory() ? "directory" : "file",
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
    });
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

// GET /api/fs/readdir?path=...
router.get("/readdir", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    // Check if path is a file. return ENOTDIR instead of crashing
    const stat = await fs.promises.stat(resolved);

    if (!stat.isDirectory()) {
      return res
        .status(400)
        .json({ error: "ENOTDIR: not a directory", code: "ENOTDIR" });
    }

    const entries = await fs.promises.readdir(resolved, {
      withFileTypes: true,
    });

    res.json(
      entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      })),
    );
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

// GET /api/fs/readFile?path=...&encoding=...
router.get("/readFile", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    const stat = await fs.promises.stat(resolved);

    if (stat.isDirectory()) {
      return res.status(400).json({
        error: "EISDIR: illegal operation on a directory",
        code: "EISDIR",
      });
    }

    const encoding = req.query.encoding;

    if (encoding === "utf8" || encoding === "utf-8") {
      const data = await fs.promises.readFile(resolved, "utf-8");

      res.type("text/plain").send(data);
    } else {
      const data = await fs.promises.readFile(resolved);

      res.type("application/octet-stream").send(data);
    }
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/writeFile { path, content, encoding?, vault? }
router.post("/writeFile", async (req, res) => {
  const resolved = guardPath(req, res, "body");

  if (!resolved) {
    return;
  }

  try {
    // Ensure parent directory exists
    const dir = path.dirname(resolved);
    await fs.promises.mkdir(dir, { recursive: true });

    const encoding = req.body.encoding || "utf-8";
    let data = req.body.content;

    if (req.body.base64) {
      data = Buffer.from(req.body.content, "base64");
    }

    await fs.promises.writeFile(
      resolved,
      data,
      encoding === "binary" ? undefined : encoding,
    );

    const stat = await fs.promises.stat(resolved);

    res.json({ ok: true, mtime: stat.mtimeMs, size: stat.size });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/appendFile { path, content, vault? }
router.post("/appendFile", async (req, res) => {
  const resolved = guardPath(req, res, "body");

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.appendFile(resolved, req.body.content, "utf-8");

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/mkdir { path, recursive?, vault? }
router.post("/mkdir", async (req, res) => {
  const resolved = guardPath(req, res, "body");

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.mkdir(resolved, {
      recursive: !!req.body.recursive,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/rename { oldPath, newPath, vault? }
router.post("/rename", async (req, res) => {
  const vaultRoot = getVaultRoot(req, res);

  if (!vaultRoot) {
    return;
  }

  const oldResolved = resolveVaultPath(vaultRoot, req.body?.oldPath);
  const newResolved = resolveVaultPath(vaultRoot, req.body?.newPath);

  if (!oldResolved || !newResolved) {
    return res.status(403).json({ error: "Invalid path" });
  }

  try {
    await fs.promises.rename(oldResolved, newResolved);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/copyFile { src, dest, vault? }
router.post("/copyFile", async (req, res) => {
  const vaultRoot = getVaultRoot(req, res);

  if (!vaultRoot) {
    return;
  }

  const srcResolved = resolveVaultPath(vaultRoot, req.body?.src);
  const destResolved = resolveVaultPath(vaultRoot, req.body?.dest);

  if (!srcResolved || !destResolved) {
    return res.status(403).json({ error: "Invalid path" });
  }

  try {
    await fs.promises.copyFile(srcResolved, destResolved);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// DELETE /api/fs/unlink?path=...
router.delete("/unlink", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.unlink(resolved);

    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ENOENT") {
      // File already gone  -  desired outcome achieved
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: e.message, code: e.code });
    }
  }
});

// DELETE /api/fs/rmdir?path=...
router.delete("/rmdir", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.rmdir(resolved);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// DELETE /api/fs/rm?path=...&recursive=true
router.delete("/rm", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.rm(resolved, {
      recursive: req.query.recursive === "true",
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

router.get("/access", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.access(resolved);

    res.json({ ok: true });
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

router.get("/realpath", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    const real = await fs.promises.realpath(resolved);

    res.json({ path: path.relative(req._vaultRoot, real) });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// POST /api/fs/utimes { path, atime, mtime, vault? }
router.post("/utimes", async (req, res) => {
  const resolved = guardPath(req, res, "body");

  if (!resolved) {
    return;
  }

  try {
    await fs.promises.utimes(
      resolved,
      req.body.atime / 1000,
      req.body.mtime / 1000,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// GET /api/fs/tree?path=...&vault=... returns full recursive file tree with metadata
router.get("/tree", async (req, res) => {
  const vaultRoot = getVaultRoot(req, res);

  if (!vaultRoot) {
    return;
  }

  const rootPath = req.query.path
    ? resolveVaultPath(vaultRoot, req.query.path)
    : vaultRoot;

  if (!rootPath) {
    return res.status(403).json({ error: "Invalid path" });
  }

  try {
    const tree = {};

    async function walk(dir, prefix) {
      const entries = await fs.promises.readdir(dir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const rel = prefix ? prefix + "/" + entry.name : entry.name;
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          tree[rel] = { type: "directory" };

          await walk(full, rel);
        } else {
          const stat = await fs.promises.stat(full);

          tree[rel] = {
            type: "file",
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: stat.ctimeMs,
          };
        }
      }
    }

    await walk(rootPath, "");

    res.json(tree);
  } catch (e) {
    res.status(500).json({ error: e.message, code: e.code });
  }
});

// GET /api/fs/download?path=...&vault=...
router.get("/download", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    const stat = await fs.promises.stat(resolved);

    if (stat.isDirectory()) {
      return res
        .status(400)
        .json({ error: "Use /download-zip for directories" });
    }

    const filename = path.basename(resolved);
    res.setHeader(
      "Content-Disposition",
      encodeContentDispositionFilename(filename),
    );
    res.sendFile(resolved);
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

// GET /api/fs/download-zip?path=...&vault=...
router.get("/download-zip", async (req, res) => {
  const resolved = guardPath(req, res);

  if (!resolved) {
    return;
  }

  try {
    const stat = await fs.promises.stat(resolved);

    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Not a directory" });
    }

    const folderName = path.basename(resolved);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      encodeContentDispositionFilename(folderName + ".zip"),
    );

    const archive = archiver("zip", { zlib: { level: 5 } });

    archive.on("error", (err) => {
      res.status(500).end();
    });

    archive.pipe(res);
    archive.directory(resolved, folderName);
    archive.finalize();
  } catch (e) {
    res
      .status(e.code === "ENOENT" ? 404 : 500)
      .json({ error: e.message, code: e.code });
  }
});

module.exports = router;
module.exports.resolveVaultPath = resolveVaultPath;
module.exports.encodeContentDispositionFilename = encodeContentDispositionFilename;
