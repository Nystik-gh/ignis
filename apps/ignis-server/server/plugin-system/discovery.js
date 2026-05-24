const fs = require("fs");
const path = require("path");

function discoverPlugins(pluginsDir) {
  const discovered = new Map();

  let entries;

  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return discovered;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const pluginPath = path.join(pluginsDir, entry.name);
    const indexPath = path.join(pluginPath, "index.js");

    if (!fs.existsSync(indexPath)) {
      continue;
    }

    let plugin;

    try {
      plugin = require(indexPath);
    } catch (e) {
      console.warn(`[plugins] Failed to load ${entry.name}: ${e.message}`);
      continue;
    }

    if (!plugin.id || !plugin.name || typeof plugin.register !== "function") {
      console.warn(
        `[plugins] Skipping ${entry.name}: missing id, name, or register`,
      );
      continue;
    }

    let bundledManifest = null;

    if (plugin.obsidianPlugin) {
      try {
        bundledManifest = JSON.parse(
          fs.readFileSync(
            path.join(plugin.obsidianPlugin, "manifest.json"),
            "utf-8",
          ),
        );
      } catch {
        // No valid bundled plugin manifest
      }
    }

    discovered.set(plugin.id, {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description || "",
      obsidianPlugin: plugin.obsidianPlugin || null,
      bundledPluginId: bundledManifest ? bundledManifest.id : null,
      bundledManifest,
      module: plugin,
    });

    console.log(`[plugins] Discovered: ${plugin.name}`);
  }

  return discovered;
}

module.exports = { discoverPlugins };
