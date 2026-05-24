const express = require("express");
const fs = require("fs");
const path = require("path");
const compression = require("compression");
const config = require("./config");
const { getVersion } = require("./version");
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
writeCoalescer.configure({ writeCoalesceMs: config.writeCoalesceMs });
const { flushAll } = writeCoalescer;
const { setupDemo, wireDemoWebSocket } = require("./demo");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RESET = "\x1b[0m";

const app = express();

app.use(express.json({ limit: "50mb" }));
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
const bootstrapRoutes = require("./routes/bootstrap");

app.use("/assets", express.static(path.join(__dirname, "assets")));

// Demo mode: layers session/quota/allowlist middleware on top of the existing routes.
// Must run BEFORE the routes are mounted. No-op when DEMO_MODE != true.
setupDemo(app);

app.use("/api/fs", fsRoutes);
app.use("/api/vault", vaultRoutes);
app.use("/api/proxy", proxyRoutes);
app.use("/api/version", versionRoutes);
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

  // Build from our own template
  const templatePath = path.join(__dirname, "assets", "index.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  html = html.replace("__IGNIS_UI_SRC__", `ignis-ui.js?v=${version}`);
  html = html.replace("__SHIM_LOADER_SRC__", `shim-loader.js?v=${version}`);
  html = html.replace("__OBSIDIAN_SCRIPTS__", JSON.stringify(scripts));

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

// Serve dist files with cache headers based on version param
app.use((req, res, next) => {
  if (req.path.match(/\/(ignis-ui|shim-loader)\.js$/)) {
    if (req.query.v) {
      // Versioned assets - cache for 1 year
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      // No version param - short cache for dev/fallback
      res.setHeader("Cache-Control", "public, max-age=300");
    }
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

const wss = setupWebSocket(server, { getVaultPath: config.getVaultPath });
wireDemoWebSocket(server);

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
