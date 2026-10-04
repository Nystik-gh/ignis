const { watcher } = require("@ignis/server-core");
const { cache } = require("./state");

const PLUGINS_DIR = ".obsidian/plugins";

const HEAVY_PLUGIN_FILES = 500;

const LIVE_PLUGIN_FILES = [
  "manifest.json",
  "main.js",
  "styles.css",
  "data.json",
];

function countPluginFiles(tree, includeIgnored) {
  const plugins = new Map();

  for (const [relPath, node] of Object.entries(tree)) {
    if (node.type !== "file" || !relPath.startsWith(PLUGINS_DIR + "/")) {
      continue;
    }

    const segments = relPath.slice(PLUGINS_DIR.length + 1).split("/");

    if (
      segments.length < 2 ||
      (!includeIgnored && watcher.isIgnoredPath(relPath))
    ) {
      continue;
    }

    const pluginDir = PLUGINS_DIR + "/" + segments[0];
    let counts = plugins.get(pluginDir);

    if (!counts) {
      counts = { total: 0, root: 0, subdirs: new Map() };
      plugins.set(pluginDir, counts);
    }

    counts.total++;

    if (segments.length === 2) {
      counts.root++;
    } else {
      const subdir = segments[1];

      counts.subdirs.set(subdir, (counts.subdirs.get(subdir) || 0) + 1);
    }
  }

  return plugins;
}

function patternsFor(pluginDir, counts) {
  if (counts.root > HEAVY_PLUGIN_FILES) {
    return [
      pluginDir + "/*",
      ...LIVE_PLUGIN_FILES.map((name) => `!${pluginDir}/${name}`),
    ];
  }

  const ranked = [...counts.subdirs].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const patterns = [];
  let remaining = counts.total;

  for (const [subdir, count] of ranked) {
    if (remaining <= HEAVY_PLUGIN_FILES) {
      break;
    }

    patterns.push(`${pluginDir}/${subdir}`);
    remaining -= count;
  }

  return patterns;
}

function isLineCovered(line) {
  const dir = line.replace(/\/\*$/, "");

  return watcher.isIgnoredPath(`${dir}/any-file`);
}

function suggestionsForTree(tree, includeIgnored = false) {
  const suggestions = [];

  for (const [pluginDir, counts] of countPluginFiles(tree, includeIgnored)) {
    if (counts.total <= HEAVY_PLUGIN_FILES) {
      continue;
    }

    const patterns = patternsFor(pluginDir, counts);
    const ignoreLines = patterns.filter((pattern) => !pattern.startsWith("!"));

    suggestions.push({
      pluginDir,
      fileCount: counts.total,
      patterns,
      covered: ignoreLines.every((line) => isLineCovered(line)),
    });
  }

  return suggestions.sort(
    (a, b) =>
      b.fileCount - a.fileCount || a.pluginDir.localeCompare(b.pluginDir),
  );
}

function ignoreSuggestions() {
  const all = [];

  for (const [vaultId, entry] of cache) {
    for (const suggestion of suggestionsForTree(entry.response.tree, true)) {
      all.push({ vault: vaultId, ...suggestion });
    }
  }

  return all;
}

module.exports = {
  HEAVY_PLUGIN_FILES,
  suggestionsForTree,
  ignoreSuggestions,
};
