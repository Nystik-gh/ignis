const esbuild = require("esbuild");
const path = require("path");

Promise.all([
  // Build shim-loader.js (delegated to packages/shim)
  require("./packages/shim/build.js"),

  // Build ignis-ui.js (delegated to packages/ui)
  require("./packages/ui/build.js"),

  // Build ignis-bridge plugin
  esbuild.build({
    entryPoints: [path.join(__dirname, "plugin", "src", "main.js")],
    bundle: true,
    outfile: path.join(__dirname, "plugin", "main.js"),
    format: "cjs",
    platform: "browser",
    target: ["chrome90"],
    external: ["obsidian", "fs"],
    logLevel: "info",
  }),

  // Build headless-sync bundled plugin
  esbuild.build({
    entryPoints: [
      path.join(
        __dirname,
        "server",
        "plugins",
        "headless-sync",
        "plugin",
        "src",
        "main.js",
      ),
    ],
    bundle: true,
    outfile: path.join(
      __dirname,
      "server",
      "plugins",
      "headless-sync",
      "plugin",
      "main.js",
    ),
    format: "cjs",
    platform: "browser",
    target: ["chrome90"],
    external: ["obsidian", "fs"], //using fs shim
    logLevel: "info",
  }),
]).catch(() => process.exit(1));
