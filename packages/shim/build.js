const esbuild = require("esbuild");
const path = require("path");

const { version: ignisVersion } = require("../../package.json");

module.exports = esbuild.build({
  entryPoints: [path.join(__dirname, "src", "loader.js")],
  bundle: true,
  outfile: path.join(__dirname, "dist", "shim-loader.js"),
  format: "iife",
  platform: "browser",
  target: ["chrome90"],
  alias: {
    path: "path-browserify",
  },
  define: {
    __IGNIS_VERSION__: JSON.stringify(ignisVersion),
  },
  logLevel: "info",
});
