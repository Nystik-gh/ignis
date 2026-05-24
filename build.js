const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const headlessSyncDir = path.join(
  __dirname,
  "apps",
  "ignis-server",
  "server",
  "plugins",
  "headless-sync",
  "obsidian",
);

Promise.all([
  // Build shim-loader.js (delegated to packages/shim)
  require("./packages/shim/build.js"),

  // Build ignis-ui.js (delegated to packages/ui)
  require("./packages/ui/build.js"),

  // Build headless-sync bundled plugin
  esbuild
    .build({
      entryPoints: [path.join(headlessSyncDir, "src", "main.js")],
      bundle: true,
      outfile: path.join(headlessSyncDir, "dist", "ignis-headless-sync.js"),
      format: "cjs",
      platform: "browser",
      target: ["chrome90"],
      external: ["obsidian", "fs"],
      logLevel: "info",
    })
    .then(() => {
      fs.copyFileSync(
        path.join(headlessSyncDir, "styles.css"),
        path.join(headlessSyncDir, "dist", "ignis-headless-sync.css"),
      );
    }),
]).catch(() => process.exit(1));
