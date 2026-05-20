// Eager batch pre-fetch of vault content into ContentCache.
//
// Fired once after the metadata cache is populated. Iterates the tree in
// directory-traversal order and pulls text file contents in batches via
// /api/fs/batch-read. Caps at MAX_BYTES so it doesn't thrash the LRU.
// Drops content directly into ContentCache; the indexer hits the cache
// instead of fetching each file individually.

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".json", ".csv",
  ".css", ".js", ".ts", ".tsx", ".mjs", ".cjs",
  ".html", ".xml", ".yaml", ".yml", ".toml",
  ".svg",
]);

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_FILE_BYTES = 512 * 1024; // skip files larger than 512 KB
const BATCH_SIZE = 50;

function isTextPath(path) {
  const dot = path.lastIndexOf(".");

  if (dot < 0) {
    return false;
  }

  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function selectPrefetchTargets(tree) {
  const paths = [];
  let bytes = 0;

  // Iterate in tree key order, which already matches directory traversal
  // because the server's walk emits parent-before-children.
  for (const [path, entry] of Object.entries(tree)) {
    if (entry.type !== "file") {
      continue;
    }

    if (!isTextPath(path)) {
      continue;
    }

    const size = entry.size || 0;

    if (size === 0 || size > MAX_FILE_BYTES) {
      continue;
    }

    if (bytes + size > MAX_BYTES) {
      break;
    }

    paths.push(path);
    bytes += size;
  }

  return { paths, bytes };
}

async function fetchBatch(vaultId, paths) {
  const res = await fetch("/api/fs/batch-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault: vaultId, paths }),
  });

  if (!res.ok) {
    throw new Error("batch-read failed: " + res.status);
  }

  return res.json();
}

export async function prefetchVaultContent(vaultId, tree, contentCache) {
  if (!vaultId || !tree) {
    return;
  }

  const { paths, bytes } = selectPrefetchTargets(tree);

  if (paths.length === 0) {
    return;
  }

  const t0 = Date.now();
  let cached = 0;

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);

    try {
      const result = await fetchBatch(vaultId, batch);

      for (const [path, content] of Object.entries(result.files || {})) {
        if (typeof content === "string") {
          contentCache.set(path, content);
          cached++;
        }
      }
    } catch (e) {
      console.warn("[ignis] Prefetch batch failed:", e.message);
      return;
    }
  }

  const ms = Date.now() - t0;

  console.log(
    `[ignis] Prefetched ${cached}/${paths.length} files (${(bytes / 1024).toFixed(0)} KB) in ${ms}ms`,
  );
}
