// Maintains a set of known ignis plugin IDs for filtering.
// Populated on bridge plugin load and updated when plugins are enabled/disabled.

const knownIds = new Set(["ignis-bridge"]);

async function refresh() {
  try {
    const res = await fetch("/api/plugins");
    const plugins = await res.json();

    // Keep ignis-bridge, add all bundled plugin IDs.
    knownIds.clear();
    knownIds.add("ignis-bridge");

    for (const plugin of plugins) {
      if (plugin.bundledPluginId) {
        knownIds.add(plugin.bundledPluginId);
      }
    }
  } catch {
    // Keep whatever we had.
  }
}

function isIgnisPlugin(pluginId) {
  return knownIds.has(pluginId);
}

function addId(pluginId) {
  knownIds.add(pluginId);
}

function getKnownIds() {
  return knownIds;
}

export { refresh, isIgnisPlugin, addId, getKnownIds };
