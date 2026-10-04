const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const config = require("../config");
const {
  getDiscoveredPlugins,
  getVirtualPluginsForVault,
} = require("../plugin-system/manager");
const { getVersion } = require("../version");
const settings = require("../settings");
const {
  watcher,
  writeCoalescer,
  toVaultRel,
  fromVaultRel,
  creationTime,
} = require("@ignis/server-core");
const { getPending, pendingPaths, estimateSize } = writeCoalescer;
const {
  cache,
  pendingBuilds,
  activeCrawls,
  revalidateOnce,
  lastCrawls,
  nextEtag,
  notifyEntrySwapped,
  notifyStaleEntryServed,
} = require("./state");
const { fileNode } = require("./tree-ops");
const { getOrCompress, markCompressionStale } = require("./compress");
const {
  enqueue,
  beginCrawl,
  endCrawl,
  isCrawling,
  applyMutationRecord,
} = require("./apply");
const { invalidateVault } = require("./invalidate");
const { suggestionsForTree } = require("./ignore-suggestions");

async function walkTree(rootPath) {
  const tree = {};
  const dirMtimes = {};

  async function walk(dir, prefix) {
    // skip revalidation for excluded directories
    if (!watcher.isIgnoredPath(prefix)) {
      const stat = await fsp.stat(dir);
      dirMtimes[prefix] = stat.mtimeMs;
    }

    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        tree[relPath] = { type: "directory" };
        await walk(full, relPath);
      } else {
        try {
          const buffered = getPending(full);

          if (buffered) {
            const s = await fsp.stat(full).catch(() => null);
            const size = estimateSize(buffered.data, buffered.encoding);

            tree[relPath] = {
              type: "file",
              size,
              mtime: Date.now(),
              ctime: s ? creationTime(s) : Date.now(),
            };
          } else {
            tree[relPath] = fileNode(await fsp.stat(full));
          }
        } catch {
          tree[relPath] = { type: "file" };
        }
      }
    }
  }

  await walk(rootPath, "");

  return { tree, dirMtimes };
}

function logIgnoreSuggestions(vaultId, tree) {
  for (const { pluginDir, fileCount, patterns } of suggestionsForTree(tree)) {
    console.log(
      `[ignore-suggest] vault=${vaultId} plugin=${pluginDir} ` +
        `files=${fileCount} patterns=${patterns.join(" ")}`,
    );
  }
}

async function crawlVault(vaultId, vaultPath) {
  const result = await walkTree(vaultPath);

  lastCrawls.set(vaultId, Date.now());
  logIgnoreSuggestions(vaultId, result.tree);

  return result;
}

function buildVaultInfo(vaultId, vaultPath) {
  return {
    id: vaultId,
    name: vaultId,
    path: vaultPath,
    platform: process.platform,
    version: config.obsidianVersion,
    trustPlugins: settings.get("trustedVaults").includes(vaultId),
  };
}

function buildVaultList() {
  return Object.entries(config.vaults).map(([id, vaultPath]) => ({
    id,
    name: id,
    path: vaultPath,
  }));
}

function buildResponse(vaultId, vaultPath, tree, etag) {
  return {
    vault: buildVaultInfo(vaultId, vaultPath),
    vaultList: buildVaultList(),
    tree,
    etag,
    plugins: getDiscoveredPlugins(),
    virtualPlugins: getVirtualPluginsForVault(vaultId, getVersion()),
    settings: {
      contentCacheBytes: settings.get("contentCacheBytes"),
      inputCacheBytes: settings.get("inputCacheBytes"),
      inputCacheTtlMs: settings.get("inputCacheTtlMs"),
      directFetchHosts: settings.get("directFetchHosts"),
      devSuppressWriteFailures: config.devSuppressWriteFailures,
      devForceReadingView: config.devForceReadingView,
    },
  };
}

async function dirMtimesUnchanged(vaultPath, dirMtimes) {
  const checks = await Promise.all(
    Object.entries(dirMtimes).map(async ([relDir, oldMtime]) => {
      const absDir = fromVaultRel(vaultPath, relDir);

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

  // consume vaultid for revalidation
  const revalidate = revalidateOnce.delete(vaultId);

  if (cached) {
    if (
      !(watcher.isWatching(vaultId) && !revalidate) &&
      !(await dirMtimesUnchanged(vaultPath, cached.dirMtimes))
    ) {
      notifyStaleEntryServed(vaultId);
    }

    return cached;
  }

  const t0 = Date.now();
  const etag = nextEtag();
  const crawl = beginCrawl(vaultId);

  try {
    const { tree, dirMtimes } = await crawlVault(vaultId, vaultPath);

    const response = buildResponse(vaultId, vaultPath, tree, etag);
    const entry = { response, dirMtimes, compressed: {}, etag };

    await getOrCompress(entry);

    await enqueue(vaultId, () => swapEntry(vaultId, vaultPath, entry, crawl));

    const ms = Date.now() - t0;
    const fileCount = Object.keys(tree).filter(
      (k) => tree[k].type === "file",
    ).length;
    const dirCount = Object.keys(dirMtimes).length;

    console.log(
      `[bootstrap] vault=${vaultId} build files=${fileCount} dirs=${dirCount} time=${ms}ms`,
    );

    return entry;
  } finally {
    endCrawl(vaultId, crawl);
  }
}

async function swapEntry(vaultId, vaultPath, entry, crawl) {
  if (activeCrawls.get(vaultId) !== crawl) {
    return;
  }

  try {
    let changed = false;

    for (const mutation of crawl.mutations) {
      const applied = await applyMutationRecord(vaultPath, entry, mutation);
      changed = changed || applied;
    }

    if (changed) {
      markCompressionStale(entry);
    }
  } catch (e) {
    console.warn(`[bootstrap] replay failed on vault ${vaultId}:`, e.message);
    invalidateVault(vaultId);

    return;
  }

  // An invalidation can land during the replay's own I/O.
  if (activeCrawls.get(vaultId) !== crawl) {
    return;
  }

  // the crawl must end before the entry is stored.
  endCrawl(vaultId, crawl);
  cache.set(vaultId, entry);
  notifyEntrySwapped(vaultId, entry.etag);
}

function pendingRelPaths(vaultPath) {
  const relPaths = new Set();

  for (const absPath of pendingPaths()) {
    const relPath = toVaultRel(path.relative(vaultPath, absPath));

    if (relPath && relPath !== ".." && !relPath.startsWith("../")) {
      relPaths.add(relPath);
    }
  }

  return relPaths;
}

function getParentDirs(path) {
  const dirs = [];
  let lastSlash = path.lastIndexOf("/");

  while (lastSlash > 0) {
    dirs.push(path.slice(0, lastSlash));
    lastSlash = path.lastIndexOf("/", lastSlash - 1);
  }

  return dirs;
}

function isPathInAnySubtree(path, roots) {
  return roots.has(path) || getParentDirs(path).some((dir) => roots.has(dir));
}

function buildExclusionPredicate(
  mutationRecords,
  pending,
  includeIgnored = false,
) {
  const skippedSubtrees = new Set();
  const skippedDirs = new Set();

  for (const mutation of mutationRecords) {
    const paths = [mutation.path];

    if (mutation.toPath) {
      paths.push(mutation.toPath); // a rename also touches its destination
    }

    for (const path of paths) {
      skippedSubtrees.add(path);

      for (const dir of getParentDirs(path)) {
        skippedDirs.add(dir);
      }
    }
  }

  const isExcluded = (path) =>
    (!includeIgnored && watcher.isIgnoredPath(path)) ||
    pending.has(path) ||
    skippedDirs.has(path) ||
    isPathInAnySubtree(path, skippedSubtrees);

  return isExcluded;
}

function nodesEqual(a, b) {
  return (
    a.type === b.type &&
    a.size === b.size &&
    a.mtime === b.mtime &&
    a.ctime === b.ctime
  );
}

function diffTrees(stored, fresh, excluded) {
  const missing = [];
  const extra = [];
  const changed = [];

  for (const path of Object.keys(fresh)) {
    if (excluded(path)) {
      continue;
    }

    const node = stored[path];

    if (!node) {
      missing.push(path);
    } else if (!nodesEqual(node, fresh[path])) {
      changed.push(path);
    }
  }

  for (const path of Object.keys(stored)) {
    if (!(path in fresh) && !excluded(path)) {
      extra.push(path);
    }
  }

  return { missing, extra, changed };
}

const DRIFT_SAMPLE = 5;

function describeDrift(drift) {
  const paths = [...drift.missing, ...drift.extra, ...drift.changed];
  const rest = paths.length - DRIFT_SAMPLE;
  const sample =
    paths.slice(0, DRIFT_SAMPLE).join(", ") + (rest > 0 ? `, +${rest}` : "");

  return (
    `missing=${drift.missing.length} extra=${drift.extra.length} ` +
    `changed=${drift.changed.length} (${sample})`
  );
}

function adoptDirMtimes(vaultId, crawl, entry, dirMtimes) {
  if (activeCrawls.get(vaultId) !== crawl || cache.get(vaultId) !== entry) {
    return;
  }

  for (const dir of Object.keys(entry.dirMtimes)) {
    if (dir in dirMtimes) {
      entry.dirMtimes[dir] = dirMtimes[dir];
    }
  }
}

async function reconcileVault(vaultId, { includeIgnored = false } = {}) {
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath || isCrawling(vaultId) || !cache.has(vaultId)) {
    return null;
  }

  const crawl = beginCrawl(vaultId);

  // snapshot paths that may get flushed during the walk
  const snapshot = pendingRelPaths(vaultPath);

  try {
    const { tree, dirMtimes } = await crawlVault(vaultId, vaultPath);

    const entry = cache.get(vaultId);

    if (!entry) {
      return null;
    }

    // merge all pending paths for exclusion
    const pending = new Set([...snapshot, ...pendingRelPaths(vaultPath)]);

    const drift = diffTrees(
      entry.response.tree,
      tree,
      buildExclusionPredicate(crawl.mutations, pending, includeIgnored),
    );

    const drifted =
      drift.missing.length + drift.extra.length + drift.changed.length > 0;

    if (!drifted) {
      // a mutation never refreshes its parent dir's recorded mtime
      await enqueue(vaultId, () =>
        adoptDirMtimes(vaultId, crawl, entry, dirMtimes),
      );

      return { drifted, ...drift };
    }

    console.warn(
      `[tree-reconcile] vault=${vaultId} drift ${describeDrift(drift)}`,
    );

    const etag = nextEtag();
    const replacement = {
      response: buildResponse(vaultId, vaultPath, tree, etag),
      dirMtimes,
      compressed: {},
      etag,
    };

    await enqueue(vaultId, () =>
      swapEntry(vaultId, vaultPath, replacement, crawl),
    );

    return { drifted, ...drift };
  } finally {
    endCrawl(vaultId, crawl);
  }
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

async function warmUp() {
  const ids = Object.keys(config.vaults);

  for (const id of ids) {
    try {
      await getOrBuild(id);
    } catch (e) {
      console.warn(`[bootstrap] warm-up failed for vault ${id}:`, e.message);
    }
  }
}

module.exports = {
  buildVaultInfo,
  walkTree,
  getOrBuild,
  reconcileVault,
  warmUp,
};
