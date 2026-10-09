const fs = require("fs");
const path = require("path");
const express = require("express");
const { discoverPlugins } = require("./discovery");
const configStore = require("./config-store");
const { DependencyManager } = require("./dependencies");
const { getVersion } = require("../version");

let discoveredPlugins = new Map();
const loadedPlugins = new Map();
const pluginRouters = new Map();
let pluginConfig = {};
let configPath = "";
let serverCtx = null;
let dependencyManager = null;
let lifecycleQueue = Promise.resolve();

function serializeLifecycle(operation) {
  const pending = lifecycleQueue.then(operation, operation);
  lifecycleQueue = pending.catch(() => {});
  return pending;
}

async function initPlugins(ctx) {
  serverCtx = ctx;
  configPath = path.join(ctx.config.dataRoot, "plugin-config.json");
  dependencyManager = new DependencyManager(ctx.config.dataRoot, {
    log: (msg) => console.log(`[plugins] ${msg}`),
  });

  ctx.app.use("/api/ext/:pluginId", (req, res, next) => {
    const router = pluginRouters.get(req.params.pluginId);

    if (router) {
      router(req, res, next);
    } else {
      next();
    }
  });

  const pluginsDir = path.join(__dirname, "..", "plugins");
  discoveredPlugins = discoverPlugins(pluginsDir);
  pluginConfig = await configStore.load(configPath);

  for (const [pluginId] of discoveredPlugins) {
    const enabledVaults = configStore.getEnabledVaults(pluginConfig, pluginId);

    if (enabledVaults.length === 0) {
      continue;
    }

    try {
      await loadPlugin(pluginId);

      for (const vaultId of enabledVaults) {
        const vaultPath = ctx.config.getVaultPath(vaultId);

        if (!vaultPath) {
          continue;
        }

        const loaded = loadedPlugins.get(pluginId);

        if (loaded?.module?.onVaultEnabled) {
          await loaded.module.onVaultEnabled(vaultId, vaultPath);
        }
      }
    } catch (e) {
      console.error(`[plugins] Failed to load ${pluginId}: ${e.message}`);
      console.error(e.stack);
    }
  }
}

async function shutdownPlugins() {
  await lifecycleQueue;
  console.log("[plugins] Shutting down all plugins...");

  for (const loaded of loadedPlugins.values()) {
    if (loaded.shutdown) {
      try {
        console.log(`[plugins] Shutting down: ${loaded.name}`);
        await loaded.shutdown();
      } catch (e) {
        console.error(
          `[plugins] Error shutting down ${loaded.name}: ${e.message}`,
        );
      }
    }
  }

  loadedPlugins.clear();
  pluginRouters.clear();
  console.log("[plugins] All plugins shut down");
}

function getPluginDataDir(dataRoot, pluginId) {
  return path.join(dataRoot, "plugins", pluginId);
}

async function loadPlugin(pluginId) {
  if (loadedPlugins.has(pluginId)) {
    return;
  }

  const discovered = discoveredPlugins.get(pluginId);

  if (!discovered) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const plugin = discovered.module;
  const dependencies = await dependencyManager.prepare(plugin.dependencies);
  const dataDir = getPluginDataDir(serverCtx.config.dataRoot, pluginId);

  await fs.promises.mkdir(dataDir, { recursive: true });

  const router = express.Router();

  const pluginCtx = {
    config: serverCtx.config,
    wss: serverCtx.wss,
    watcher: serverCtx.watcher,
    router,
    log: (msg) => console.log(`[plugin:${pluginId}] ${msg}`),
    dataDir,
    dependencies,
    getEnabledVaults: () =>
      configStore.getEnabledVaults(pluginConfig, pluginId),
  };

  try {
    await plugin.register(pluginCtx);
  } catch (e) {
    if (plugin.shutdown) {
      try {
        await plugin.shutdown();
      } catch (cleanupError) {
        console.error(
          `[plugins] Failed to clean up ${pluginId}: ${cleanupError.message}`,
        );
      }
    }

    throw e;
  }

  pluginRouters.set(pluginId, router);

  loadedPlugins.set(pluginId, {
    id: pluginId,
    name: discovered.name,
    module: plugin,
    ctx: pluginCtx,
    shutdown: plugin.shutdown ? plugin.shutdown.bind(plugin) : null,
  });

  console.log(`[plugins] Loaded: ${discovered.name}`);
}

async function unloadPlugin(pluginId) {
  const loaded = loadedPlugins.get(pluginId);

  if (!loaded) {
    return;
  }

  if (loaded.shutdown) {
    console.log(`[plugins] Shutting down: ${loaded.name}`);
    await loaded.shutdown();
  }

  pluginRouters.delete(pluginId);
  loadedPlugins.delete(pluginId);
  console.log(`[plugins] Unloaded: ${loaded.name}`);
}

function enablePluginForVault(pluginId, vaultId) {
  return serializeLifecycle(() => enablePlugin(pluginId, vaultId));
}

async function enablePlugin(pluginId, vaultId) {
  const discovered = discoveredPlugins.get(pluginId);

  if (!discovered) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const vaultPath = serverCtx.config.getVaultPath(vaultId);

  if (!vaultPath) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  // Failed installation must not persist an enabled flag or load a companion.
  await dependencyManager.prepare(discovered.module.dependencies);
  const before = [...configStore.getEnabledVaults(pluginConfig, pluginId)];
  const enabledVaults = [...before];
  const wasLoaded = loadedPlugins.has(pluginId);

  if (!enabledVaults.includes(vaultId)) {
    enabledVaults.push(vaultId);
    configStore.setEnabledVaults(pluginConfig, pluginId, enabledVaults);
  }

  try {
    if (!wasLoaded) {
      await loadPlugin(pluginId);
    }

    const loaded = loadedPlugins.get(pluginId);

    if (loaded?.module?.onVaultEnabled) {
      await loaded.module.onVaultEnabled(vaultId, vaultPath);
    }

    await configStore.save(configPath, pluginConfig);
  } catch (e) {
    configStore.setEnabledVaults(pluginConfig, pluginId, before);

    if (!wasLoaded && loadedPlugins.has(pluginId)) {
      await unloadPlugin(pluginId);
    } else if (wasLoaded && !before.includes(vaultId)) {
      await loadedPlugins
        .get(pluginId)
        ?.module?.onVaultDisabled?.(vaultId, vaultPath);
    }

    throw e;
  }

  // Broadcast to any open tabs on this vault so they load the plugin properly.
  if (discovered.obsidianPlugin && discovered.bundledPluginId) {
    const v = `?v=${getVersion()}`;
    const entry = {
      id: discovered.bundledPluginId,
      scriptUrl: `/${discovered.bundledPluginId}.js${v}`,
      cssUrl: `/${discovered.bundledPluginId}.css${v}`,
      manifest: discovered.bundledManifest,
    };

    serverCtx.wss?.broadcastToVault?.(vaultId, {
      type: "virtual-plugin-enable",
      vault: vaultId,
      entry,
    });
  }
}

function disablePluginForVault(pluginId, vaultId) {
  return serializeLifecycle(() => disablePlugin(pluginId, vaultId));
}

async function disablePlugin(pluginId, vaultId) {
  const discovered = discoveredPlugins.get(pluginId);

  if (!discovered) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const vaultPath = serverCtx.config.getVaultPath(vaultId);

  if (!vaultPath) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  const loaded = loadedPlugins.get(pluginId);

  if (loaded?.module?.onVaultDisabled) {
    await loaded.module.onVaultDisabled(vaultId, vaultPath);
  }

  const enabledVaults = configStore.getEnabledVaults(pluginConfig, pluginId);
  const updated = enabledVaults.filter((id) => id !== vaultId);
  configStore.setEnabledVaults(pluginConfig, pluginId, updated);
  await configStore.save(configPath, pluginConfig);

  if (updated.length === 0) {
    await unloadPlugin(pluginId);
  }

  if (discovered.bundledPluginId) {
    serverCtx.wss?.broadcastToVault?.(vaultId, {
      type: "virtual-plugin-disable",
      vault: vaultId,
      id: discovered.bundledPluginId,
    });
  }
}

function getBundledPluginDirs() {
  const dirs = [];

  for (const [, discovered] of discoveredPlugins) {
    if (discovered.obsidianPlugin && discovered.bundledPluginId) {
      dirs.push({
        bundledPluginId: discovered.bundledPluginId,
        distDir: path.join(discovered.obsidianPlugin, "dist"),
      });
    }
  }

  return dirs;
}

function getVirtualPluginsForVault(vaultId, version) {
  const v = version ? `?v=${version}` : "";
  const result = [];

  for (const [pluginId, discovered] of discoveredPlugins) {
    if (!discovered.obsidianPlugin || !discovered.bundledPluginId) {
      continue;
    }

    const enabledVaults = configStore.getEnabledVaults(pluginConfig, pluginId);

    if (!enabledVaults.includes(vaultId)) {
      continue;
    }

    result.push({
      id: discovered.bundledPluginId,
      scriptUrl: `/${discovered.bundledPluginId}.js${v}`,
      cssUrl: `/${discovered.bundledPluginId}.css${v}`,
      manifest: discovered.bundledManifest,
    });
  }

  return result;
}

function getDiscoveredPlugins() {
  const result = [];

  for (const [pluginId, discovered] of discoveredPlugins) {
    result.push({
      id: discovered.id,
      name: discovered.name,
      description: discovered.description,
      hasBundledPlugin: !!discovered.obsidianPlugin,
      bundledPluginId: discovered.bundledPluginId,
      enabledVaults: configStore.getEnabledVaults(pluginConfig, pluginId),
      loaded: loadedPlugins.has(pluginId),
    });
  }

  return result;
}

module.exports = {
  initPlugins,
  shutdownPlugins,
  getPluginDataDir,
  enablePluginForVault,
  disablePluginForVault,
  getDiscoveredPlugins,
  getBundledPluginDirs,
  getVirtualPluginsForVault,
};
