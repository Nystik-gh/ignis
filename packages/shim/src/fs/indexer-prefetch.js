// Pre-fetches vault file contents into the content cache before Obsidian boots, so its startup reads hit the cache instead of the network.
// The priority slice is awaited and gates boot; the bulk slice streams afterward without blocking it.

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".csv",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".svg",
]);

const MAX_FILE_BYTES = 512 * 1024;
// Plugin bundles run a few MB and Obsidian needs them at boot, so priority accepts larger files than bulk.
const PRIORITY_MAX_FILE_BYTES = 4 * 1024 * 1024;
const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 6; // concurrent in-flight batch-reads, to pipeline requests and hide round-trip latency
// Cap a slice's file count so a vault or plugin with tens of thousands of small files cannot turn boot into one request per file.
const MAX_FILES = 4000;
const PREFETCH_CACHE_FRACTION = 0.75; // leave cache headroom so on-demand reads do not immediately evict prefetched content
const PREFETCH_MAX_BYTES = 100 * 1024 * 1024; // ceiling on boot prefetch I/O regardless of cache size
const PREFETCH_MIN_BYTES = 8 * 1024 * 1024; // floor; a cache below 8 MB is clamped to its own size instead
const DEFAULT_CACHE_BYTES = 50 * 1024 * 1024;

function isTextPath(path) {
  const dot = path.lastIndexOf(".");

  if (dot < 0) {
    return false;
  }

  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

// Boot-critical files: root .obsidian configs and each plugin's entry files.
function isPriorityPath(path) {
  if (!path.startsWith(".obsidian/")) {
    return false;
  }

  if (/^\.obsidian\/[^/]+\.json$/.test(path)) {
    return true;
  }

  return /^\.obsidian\/plugins\/[^/]+\/(main\.js|manifest\.json|styles\.css)$/.test(
    path,
  );
}

function isDataJsonPath(path) {
  return /^\.obsidian\/plugins\/[^/]+\/data\.json$/.test(path);
}

// Plugin-internal files (icon packs, fonts) are read on demand, never at boot, and a plugin can bundle tens of thousands, so bulk skips them.
function isPluginAsset(path) {
  return (
    /^\.obsidian\/plugins\/[^/]+\//.test(path) &&
    !isPriorityPath(path) &&
    !isDataJsonPath(path)
  );
}

// Scaled from the content cache and capped at the cache size itself, so the prefetch cannot evict its own content mid-fetch.
function prefetchByteBudget(contentCache) {
  const cacheMax =
    contentCache && Number.isFinite(contentCache.maxSize)
      ? contentCache.maxSize
      : DEFAULT_CACHE_BYTES;

  return Math.min(
    PREFETCH_MAX_BYTES,
    cacheMax,
    Math.max(
      PREFETCH_MIN_BYTES,
      Math.floor(cacheMax * PREFETCH_CACHE_FRACTION),
    ),
  );
}

function collectSlice(entries, predicate, perFileCap, budget, label) {
  const files = [];
  let bytes = 0;
  let truncated = 0;

  for (const [path, entry] of entries) {
    if (entry.type !== "file" || !isTextPath(path) || !predicate(path)) {
      continue;
    }

    const size = entry.size || 0;

    if (size === 0 || size > perFileCap) {
      continue;
    }

    if (bytes + size > budget) {
      continue;
    }

    if (files.length >= MAX_FILES) {
      truncated++;
      continue;
    }

    files.push({ path, size });
    bytes += size;
  }

  if (truncated > 0) {
    console.warn(
      `[ignis] Prefetch ${label} slice hit the ${MAX_FILES}-file cap; ${truncated} file(s) left for on-demand reads.`,
    );
  }

  return { files, bytes };
}

function selectPrefetchTargets(tree, totalBudget) {
  // Tree key order matches directory traversal (the server walk emits parent before children).
  const entries = Object.entries(tree);

  // Priority draws from the whole budget first since its files are read during boot; warming them up front beats reading them on demand.
  // Admit the core boot files before each plugin's data.json so a large data.json cannot crowd out a core file.
  const core = collectSlice(
    entries,
    isPriorityPath,
    PRIORITY_MAX_FILE_BYTES,
    totalBudget,
    "priority",
  );

  const data = collectSlice(
    entries,
    isDataJsonPath,
    PRIORITY_MAX_FILE_BYTES,
    totalBudget - core.bytes,
    "data.json",
  );

  const priority = {
    files: [...core.files, ...data.files],
    bytes: core.bytes + data.bytes,
  };

  const admitted = new Set(priority.files.map((f) => f.path));

  const bulk = collectSlice(
    entries,
    (path) => !admitted.has(path) && !isPluginAsset(path),
    MAX_FILE_BYTES,
    totalBudget - priority.bytes,
    "bulk",
  );

  return { priority, bulk };
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

async function runBatches(vaultId, slice, contentCache, label, onProgress) {
  if (slice.files.length === 0) {
    return;
  }

  const t0 = Date.now();
  let cached = 0;
  let received = 0;

  // Report the total up front so the splash shows the target before the first batch lands.
  if (onProgress) {
    onProgress(0, slice.bytes);
  }

  const batches = [];

  for (let i = 0; i < slice.files.length; i += BATCH_SIZE) {
    batches.push(slice.files.slice(i, i + BATCH_SIZE));
  }

  // Several workers pull batches off a shared cursor until all batches are processed or one fails.
  let cursor = 0;
  let aborted = false;

  async function worker() {
    while (!aborted) {
      const idx = cursor++;

      if (idx >= batches.length) {
        return;
      }

      const batch = batches[idx];

      let result;

      try {
        result = await fetchBatch(
          vaultId,
          batch.map((f) => f.path),
        );
      } catch (e) {
        console.warn(`[ignis] Prefetch ${label} batch failed:`, e.message);
        aborted = true;
        return;
      }

      for (const [path, content] of Object.entries(result.files || {})) {
        if (typeof content === "string") {
          contentCache.set(path, content);
          cached++;
        }
      }

      if (onProgress) {
        for (const f of batch) {
          received += f.size;
        }

        onProgress(received, slice.bytes);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(BATCH_CONCURRENCY, batches.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const ms = Date.now() - t0;

  console.log(
    `[ignis] Prefetched ${label} ${cached}/${slice.files.length} files (${(slice.bytes / 1024).toFixed(0)} KB) in ${ms}ms`,
  );
}

// The priority promise resolves once the boot-critical files land (or are abandoned on a batch failure), so it is always safe to await.
export function prefetchVaultContent(
  vaultId,
  tree,
  contentCache,
  options = {},
) {
  if (!vaultId || !tree) {
    return { priority: Promise.resolve(), bulk: Promise.resolve() };
  }

  const totalBudget = prefetchByteBudget(contentCache);
  const { priority, bulk } = selectPrefetchTargets(tree, totalBudget);

  const priorityDone = runBatches(
    vaultId,
    priority,
    contentCache,
    "priority",
    options.onProgress,
  );

  // Bulk streams after priority so it does not contend for connections while boot waits on priority, and swallows its own rejection.
  const bulkDone = priorityDone
    .catch(() => {})
    .then(() => runBatches(vaultId, bulk, contentCache, "bulk"))
    .catch((e) => {
      console.warn("[ignis] Prefetch bulk failed:", e && e.message);
    });

  return { priority: priorityDone, bulk: bulkDone };
}
