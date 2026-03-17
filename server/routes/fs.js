const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("../config");

const router = express.Router();

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

  if (!resolved.startsWith(path.resolve(vaultRoot))) {
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
    await fs.promises.mkdir(resolved, { recursive: !!req.body.recursive });

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
    const status = e.code === "ENOENT" ? 404 : 500;

    res.status(status).json({ error: e.message, code: e.code });
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
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

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

module.exports = router;
