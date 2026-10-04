const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getVersion } = require("../version");
const { versionedSrc } = require("./cache-headers");
const { getObsidianTerms } = require("./obsidian-terms");

let cachedHtml = null;

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

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
  const templatePath = path.join(__dirname, "..", "assets", "index.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  html = html.replace("__OBSIDIAN_TERMS__", scriptJson(getObsidianTerms()));
  html = html.replace("__IGNIS_UI_SRC__", `ignis-ui.js?v=${version}`);
  html = html.replace("__SHIM_LOADER_SRC__", `shim-loader.js?v=${version}`);
  html = html.replace(
    "__APP_CSS_SRC__",
    versionedSrc("app.css", obsidianVersion),
  );
  html = html.replace(
    "__OBSIDIAN_SCRIPTS__",
    JSON.stringify(scripts.map((s) => versionedSrc(s, obsidianVersion))),
  );

  cachedHtml = html;
  return cachedHtml;
}

module.exports = { buildIndexHtml };
