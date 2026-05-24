// Bootstrap endpoint for cold start.
//
// Combines vault info, vault list, metadata tree, and plugin list into a single pre-compressed response.
// Cache is per-vault and invalidated by directory mtime check + explicit invalidateVault() calls from the write/delete routes.

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");
const config = require("../config");
const {
  getDiscoveredPlugins,
  getVirtualPluginsForVault,
} = require("../plugin-system/manager");
const { getVersion } = require("../version");

const router = express.Router();

// vaultId -> { response, dirMtimes, compressed: { br, gz } }
const cache = new Map();

// vaultId -> Promise<entry>  (in-flight build dedup)
const pendingBuilds = new Map();

function preCompress(buf) {
  return Promise.all([
    new Promise((resolve, reject) => {
      zlib.brotliCompress(
        buf,
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    }),
    new Promise((resolve, reject) => {
      zlib.gzip(buf, { level: 6 }, (err, result) =>
        err ? reject(err) : resolve(result),
      );
    }),
  ]).then(([br, gz]) => ({ br, gz }));
}

async function walkTree(rootPath) {
  const tree = {};
  const dirMtimes = {};

  async function walk(dir, prefix) {
    const stat = await fsp.stat(dir);
    dirMtimes[prefix] = stat.mtimeMs;

    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        tree[rel] = { type: "directory" };
        await walk(full, rel);
      } else {
        try {
          const s = await fsp.stat(full);

          tree[rel] = {
            type: "file",
            size: s.size,
            mtime: s.mtimeMs,
            ctime: s.ctimeMs,
          };
        } catch {
          tree[rel] = { type: "file" };
        }
      }
    }
  }

  await walk(rootPath, "");

  return { tree, dirMtimes };
}

function buildVaultInfo(vaultId, vaultPath) {
  return {
    id: vaultId,
    name: vaultId,
    path: vaultPath,
    platform: process.platform,
    version: config.obsidianVersion,
  };
}

function buildVaultList() {
  return Object.entries(config.vaults).map(([id, vaultPath]) => ({
    id,
    name: id,
    path: vaultPath,
  }));
}

async function dirMtimesUnchanged(vaultPath, dirMtimes) {
  const checks = await Promise.all(
    Object.entries(dirMtimes).map(async ([relDir, oldMtime]) => {
      const absDir = relDir
        ? path.join(vaultPath, relDir.split("/").join(path.sep))
        : vaultPath;

      try {
        const s = await fsp.stat(absDir);
        return s.mtimeMs === oldMtime;
      } catch {
        return false;
      }
    }),
  );

  return checks.every(Boolean);
}

async function buildEntry(vaultId) {
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return null;
  }

  const cached = cache.get(vaultId);

  if (cached && (await dirMtimesUnchanged(vaultPath, cached.dirMtimes))) {
    return cached;
  }

  const t0 = Date.now();
  const vault = buildVaultInfo(vaultId, vaultPath);
  const { tree, dirMtimes } = await walkTree(vaultPath);

  const response = {
    vault,
    vaultList: buildVaultList(),
    tree,
    // In demo mode, hide server-side plugins from the client.
    plugins: config.demoMode ? [] : getDiscoveredPlugins(),
    virtualPlugins: getVirtualPluginsForVault(vaultId, getVersion()),
  };

  const jsonBuf = Buffer.from(JSON.stringify(response));
  let compressed = {};

  try {
    compressed = await preCompress(jsonBuf);
  } catch (e) {
    console.warn("[bootstrap] precompression failed:", e.message);
  }

  const entry = { response, dirMtimes, compressed };
  cache.set(vaultId, entry);

  const ms = Date.now() - t0;
  const fileCount = Object.keys(tree).filter(
    (k) => tree[k].type === "file",
  ).length;
  const dirCount = Object.keys(dirMtimes).length;

  console.log(
    `[bootstrap] vault=${vaultId} build files=${fileCount} dirs=${dirCount} time=${ms}ms`,
  );

  return entry;
}

async function getOrBuild(vaultId) {
  if (pendingBuilds.has(vaultId)) {
    return pendingBuilds.get(vaultId);
  }

  const promise = buildEntry(vaultId).finally(() => {
    pendingBuilds.delete(vaultId);
  });

  pendingBuilds.set(vaultId, promise);

  return promise;
}

function invalidateVault(vaultId) {
  cache.delete(vaultId);
}

async function warmUp() {
  const ids = Object.keys(config.vaults);

  for (const id of ids) {
    try {
      await buildEntry(id);
    } catch (e) {
      console.warn(`[bootstrap] warm-up failed for vault ${id}:`, e.message);
    }
  }
}

router.get("/", async (req, res) => {
  const vaultId = req.query.vault || config.defaultVaultId;

  if (!vaultId || !config.getVaultPath(vaultId)) {
    return res.status(404).json({ error: "Vault not found", id: vaultId });
  }

  try {
    const entry = await getOrBuild(vaultId);

    if (!entry) {
      return res.status(404).json({ error: "Vault not found" });
    }

    // In demo mode, route through res.json so the demo middleware can translate vault names per-session.
    // The pre-compressed buffer path bakes the storage prefix in and would bypass the response wrapper.
    // Deep-clone so the demo translator's in-place mutation doesn't pollute the cached response object.
    if (req._demoSessionId) {
      return res.json(JSON.parse(JSON.stringify(entry.response)));
    }

    const ae = req.headers["accept-encoding"] || "";
    const { compressed } = entry;
    let buf, encoding;

    if (ae.includes("br") && compressed.br) {
      buf = compressed.br;
      encoding = "br";
    } else if (
      (ae.includes("gzip") || ae.includes("deflate")) &&
      compressed.gz
    ) {
      buf = compressed.gz;
      encoding = "gzip";
    }

    if (buf) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Content-Length", buf.length);
      res.setHeader("Cache-Control", "no-cache");

      return res.status(200).end(buf);
    }

    res.json(entry.response);
  } catch (e) {
    console.error("[bootstrap] error:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.invalidateVault = invalidateVault;
module.exports.warmUp = warmUp;
