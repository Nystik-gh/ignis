const express = require("express");
const fs = require("fs");
const path = require("path");
const compression = require("compression");
const config = require("./config");
const settings = require("./settings");
const { getVersion } = require("./version");
const { versionedSrc, cacheControlFor } = require("./cache-headers");
const {
  setupWebSocket,
  watcher,
  writeCoalescer,
} = require("@ignis/server-core");
const {
  BRIDGE_PLUGIN_ID,
  migratePluginsFromAllVaults,
} = require("./bridge-plugin");
const {
  initPlugins,
  shutdownPlugins,
  getBundledPluginDirs,
} = require("./plugin-system/manager");
const pluginRoutes = require("./routes/plugins");
writeCoalescer.configure({ writeCoalesceMs: settings.get("writeCoalesceMs") });
const { flushAll } = writeCoalescer;
const { setupDemo, wireDemoWebSocket } = require("./demo");

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

app.use("/assets", express.static(path.join(__dirname, "assets")));

// Demo mode: layers session/quota/allowlist middleware on top of the existing routes.
// Must run BEFORE the routes are mounted. No-op when DEMO_MODE != true.
setupDemo(app);

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

  // Rewrite req.url to strip the vault ID prefix, then serve statically
  req.url = "/" + parts.slice(1).join("/");
  express.static(vaultPath)(req, res, next);
});

// Serve our own index.html. Obsidian's scripts are discovered at startup and injected dynamically by the client.
let cachedHtml = null;

function buildIndexHtml() {
  if (cachedHtml) {
    return cachedHtml;
  }

  const version = getVersion();

  // Discover Obsidian's script tags from their index.html
  const obsidianHtmlPath = path.join(config.obsidianAssetsPath, "index.html");
  const obsidianHtml = fs.readFileSync(obsidianHtmlPath, "utf-8");
  const scriptRegex = /<script[^>]+src="([^"]+)"[^>]*>/g;
  const scripts = [];
  let match;

  while ((match = scriptRegex.exec(obsidianHtml)) !== null) {
    scripts.push(match[1]);
  }

  // Version Obsidian's assets by the Obsidian version so an upgrade busts their immutable cache.
  // Omitted when the version is unknown, so nothing is pinned immutable against a wrong version.
  const ov = config.obsidianVersion;
  const obsidianVersion = ov && ov !== "0.0.0" ? ov : null;

  // Build from our own template
  const templatePath = path.join(__dirname, "assets", "index.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  html = html.replace("__IGNIS_UI_SRC__", `ignis-ui.js?v=${version}`);
  html = html.replace("__SHIM_LOADER_SRC__", `shim-loader.js?v=${version}`);
  html = html.replace("__APP_CSS_SRC__", versionedSrc("app.css", obsidianVersion));
  html = html.replace(
    "__OBSIDIAN_SCRIPTS__",
    JSON.stringify(scripts.map((s) => versionedSrc(s, obsidianVersion))),
  );

  if (config.demoMode) {
    html = html.replace(
      '<body class="theme-dark">',
      '<body class="theme-dark" data-demo-mode="true">',
    );
  }

  cachedHtml = html;
  return cachedHtml;
}

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

if (config.socketPath && fs.existsSync(config.socketPath)) {
  fs.unlinkSync(config.socketPath); // stale socket from unclean shutdown blocks bind
}

const server = app.listen(config.socketPath ?? config.port, async () => {
  if (config.socketPath) {
    fs.chmodSync(config.socketPath, 0o666); // reverse proxy runs as another user
    console.log(`[ignis] Server running on unix socket ${config.socketPath}`);
  } else {
    console.log(`[ignis] Server running on http://localhost:${config.port}`);
  }
  console.log(`[ignis] Vault root: ${config.vaultRoot}`);
  console.log(`[ignis] Vaults: ${Object.keys(config.vaults).join(", ")}`);

  await initPlugins({ app, config, wss, watcher });

  const bundledPluginDirs = getBundledPluginDirs();

  for (const { distDir } of bundledPluginDirs) {
    app.use(express.static(distDir));
  }

  await migratePluginsFromAllVaults(config.vaultRoot, [
    BRIDGE_PLUGIN_ID,
    ...bundledPluginDirs.map((d) => d.bundledPluginId),
  ]);

  bootstrapRoutes
    .warmUp()
    .catch((e) => console.warn("[bootstrap] warm-up error:", e.message));
});

const wss = setupWebSocket(server, {
  getVaultPath: config.getVaultPath,
  originAllowlist: settings.get("wsOrigins"),
});
wireDemoWebSocket(server);

async function gracefulShutdown(signal) {
  console.log(`\n[ignis] Received ${signal}, shutting down gracefully...`);

  await flushAll();
  await shutdownPlugins();

  server.close(() => {
    if (config.socketPath && fs.existsSync(config.socketPath)) {
      fs.unlinkSync(config.socketPath);
    }
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
