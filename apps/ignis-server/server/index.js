const express = require("express");
const path = require("path");
const compression = require("compression");
const config = require("./config");
const settings = require("./settings");
const { cacheControlFor } = require("./static/cache-headers");
const { buildIndexHtml } = require("./static/index-html");
const { getObsidianTerms } = require("./static/obsidian-terms");
const {
  setupWebSocket,
  watcher,
  writeCoalescer,
  resolveVaultPath,
} = require("@ignis/server-core");
const {
  BRIDGE_PLUGIN_ID,
  migratePluginsFromAllVaults,
} = require("./plugin-system/migrate-bridge");
const {
  initPlugins,
  shutdownPlugins,
  getBundledPluginDirs,
  getPluginDataDir,
} = require("./plugin-system/manager");
const obCli = require("./obsidian-account/ob-cli");
const pluginRoutes = require("./routes/plugins");
const { flushAll } = writeCoalescer;

writeCoalescer.configure({ writeCoalesceMs: settings.get("writeCoalesceMs") });
watcher.configure({ ignoredPaths: settings.resolveIgnoreLines() });
obCli.init({
  obHome: path.join(
    getPluginDataDir(config.dataRoot, "headless-sync"),
    "ob-home",
  ),
});

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RESET = "\x1b[0m";

const app = express();

// Reject oversized requests by Content-Length before parsing.
app.use((req, res, next) => {
  const declared = Number(req.headers["content-length"]);

  if (Number.isFinite(declared) && declared > settings.get("maxBodyBytes")) {
    return res.status(413).json({ error: "Request body too large" });
  }

  next();
});

app.use(express.json({ limit: settings.MAX_BODY_BACKSTOP }));
app.use(compression());

// logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  const origEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    const status = res.statusCode;

    const color =
      status >= 500 ? ANSI_RED : status >= 400 ? ANSI_YELLOW : ANSI_GREEN;

    const path =
      req.originalUrl.length > 80
        ? req.originalUrl.slice(0, 80) + "..."
        : req.originalUrl;

    console.log(
      `${color}${req.method} ${status}${ANSI_RESET} ${path} (${duration}ms)`,
    );

    origEnd.apply(this, args);
  };

  next();
});

const fsRoutes = require("./routes/fs");
const vaultRoutes = require("./routes/vault");
const proxyRoutes = require("./routes/proxy");
const versionRoutes = require("./routes/version");
const settingsRoutes = require("./routes/settings");
const bootstrapRoutes = require("./routes/bootstrap");
const bootstrapCache = require("./cache");
const treeReconcile = require("./cache/reconcile");
const { createMetadataChannel } = require("./cache/metadata-channel");
const { registerCacheListeners } = require("./cache/listeners");
const vaultLifecycle = require("./vault/lifecycle");

app.use("/assets", express.static(path.join(__dirname, "assets")));

app.use("/api/fs", fsRoutes);
app.use("/api/vault", vaultRoutes);
app.use("/api/proxy", proxyRoutes);
app.use("/api/version", versionRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/plugins", pluginRoutes);
app.use("/api/bootstrap", bootstrapRoutes);

// Serve vault files for resource URLs (images, attachments, etc.)
// Vault ID is the first path segment: /vault-files/<vault-id>/path/to/file
app.use("/vault-files", (req, res, next) => {
  // Extract vault ID from the first path segment
  const parts = req.path.split("/").filter(Boolean);

  if (parts.length === 0) {
    return res.status(400).json({ error: "Missing vault ID" });
  }

  const vaultId = decodeURIComponent(parts[0]);
  const vaultPath = config.getVaultPath(vaultId);

  if (!vaultPath) {
    return res.status(404).json({ error: "Vault not found" });
  }

  let resolved = null;

  try {
    const relPath = parts.slice(1).map(decodeURIComponent).join("/");
    resolved = relPath ? resolveVaultPath(vaultPath, relPath) : null;
  } catch {
    // resolved stays null and gets handled by static handler
  }

  const buffered = resolved ? writeCoalescer.getPending(resolved) : null;

  // Serve buffered content if exists.
  if (buffered) {
    const body = writeCoalescer.pendingBuffer(buffered.data, buffered.encoding);

    const ext = path.extname(resolved);

    if (ext) {
      res.type(ext);
    }

    return res.send(body);
  }

  // Rewrite req.url to strip the vault ID prefix, then serve statically
  req.url = "/" + parts.slice(1).join("/");
  express.static(vaultPath)(req, res, next);
});

app.get(["/", "/index.html"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-cache");
  res.send(buildIndexHtml());
});

app.get("/favicon.png", (req, res) => {
  res.sendFile(path.join(REPO_ROOT, "images", "favicon.png"));
});

// Cache headers for static assets, by version query.
// Set before express.static, which only fills Cache-Control when it is not already present.
app.use((req, res, next) => {
  const cacheControl = cacheControlFor(req.path, !!req.query.v);

  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }

  next();
});

app.use(express.static(path.join(REPO_ROOT, "packages", "ui", "dist")));
app.use(express.static(path.join(REPO_ROOT, "packages", "shim", "dist")));

app.use(express.static(config.obsidianAssetsPath));

const server = app.listen(config.port, async () => {
  console.log(`[ignis] Server running on http://localhost:${config.port}`);
  console.log(`[ignis] Vault root: ${config.vaultRoot}`);
  console.log(`[ignis] Vaults: ${Object.keys(config.vaults).join(", ")}`);

  getObsidianTerms();

  await initPlugins({ app, config, wss, watcher });

  const bundledPluginDirs = getBundledPluginDirs();

  for (const { distDir } of bundledPluginDirs) {
    app.use(express.static(distDir));
  }

  await migratePluginsFromAllVaults(config.vaultRoot, [
    BRIDGE_PLUGIN_ID,
    ...bundledPluginDirs.map((d) => d.bundledPluginId),
  ]);

  bootstrapCache
    .warmUp()
    .catch((e) => console.warn("[bootstrap] warm-up error:", e.message));
});

const wss = setupWebSocket(server, {
  getVaultPath: config.getVaultPath,
  originAllowlist: settings.get("wsOrigins"),
});
vaultLifecycle.setWss(wss);

const metadataChannel = createMetadataChannel(wss);

registerCacheListeners({
  bootstrapCache,
  metadataChannel,
  watcher,
  writeCoalescer,
});

watcher.onWatcherStart((vaultId) => {
  bootstrapCache.markForRevalidation(vaultId);
  treeReconcile.startSchedule(vaultId);
});

bootstrapCache.onStaleEntryServed((vaultId) =>
  treeReconcile.scheduleReconcile(vaultId),
);

// Per-client listeners die along with their watcher.
watcher.onWatcherRebuild((vaultId) => {
  // force revalidation to ensure any missed changes are picked up
  bootstrapCache.invalidateVault(vaultId);
  wss.closeVaultSockets(vaultId);
});

writeCoalescer.onFlushGiveUp((absPath) => {
  const match = config.vaultForPath(absPath);

  if (!match) {
    return;
  }

  wss.broadcastToVault(match.vaultId, {
    type: "write-giveup",
    path: match.relPath,
  });
});

async function gracefulShutdown(signal) {
  console.log(`\n[ignis] Received ${signal}, shutting down gracefully...`);

  await flushAll();
  await shutdownPlugins();

  server.close(() => {
    console.log("[ignis] Server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[ignis] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
