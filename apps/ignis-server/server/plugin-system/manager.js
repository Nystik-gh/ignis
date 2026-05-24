const fs = require("fs");
const path = require("path");
const express = require("express");
const { discoverPlugins } = require("./discovery");
const configStore = require("./config-store");

let discoveredPlugins = new Map();
const loadedPlugins = new Map();
const pluginRouters = new Map();
let pluginConfig = {};
let configPath = "";
let serverCtx = null;

async function initPlugins(ctx) {
  serverCtx = ctx;
  configPath = path.join(ctx.config.dataRoot, "plugin-config.json");

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
  console.log("[plugins] Shutting down all plugins...");

  for (const [pluginId, loaded] of loadedPlugins) {
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

async function loadPlugin(pluginId) {
  if (loadedPlugins.has(pluginId)) {
    return;
  }

  const discovered = discoveredPlugins.get(pluginId);

  if (!discovered) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const plugin = discovered.module;
  const dataDir = path.join(serverCtx.config.dataRoot, "plugins", pluginId);

  await fs.promises.mkdir(dataDir, { recursive: true });

  const router = express.Router();

  const pluginCtx = {
    config: serverCtx.config,
    wss: serverCtx.wss,
    watcher: serverCtx.watcher,
    router,
    log: (msg) => console.log(`[plugin:${pluginId}] ${msg}`),
    dataDir,
    getEnabledVaults: () =>
      configStore.getEnabledVaults(pluginConfig, pluginId),
  };

  await plugin.register(pluginCtx);

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

async function enablePluginForVault(pluginId, vaultId) {
  const discovered = discoveredPlugins.get(pluginId);

  if (!discovered) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const vaultPath = serverCtx.config.getVaultPath(vaultId);

  if (!vaultPath) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  const enabledVaults = configStore.getEnabledVaults(pluginConfig, pluginId);

  if (!enabledVaults.includes(vaultId)) {
    enabledVaults.push(vaultId);
    configStore.setEnabledVaults(pluginConfig, pluginId, enabledVaults);
    await configStore.save(configPath, pluginConfig);
  }

  if (!loadedPlugins.has(pluginId)) {
    await loadPlugin(pluginId);
  }

  const loaded = loadedPlugins.get(pluginId);

  if (loaded?.module?.onVaultEnabled) {
    await loaded.module.onVaultEnabled(vaultId, vaultPath);
  }
}

async function disablePluginForVault(pluginId, vaultId) {
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
  enablePluginForVault,
  disablePluginForVault,
  getDiscoveredPlugins,
  getBundledPluginDirs,
  getVirtualPluginsForVault,
};
