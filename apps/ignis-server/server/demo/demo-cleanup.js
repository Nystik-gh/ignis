// Inactivity sweep + orphan scan, run on a 60s setInterval.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const config = require("../config");
const { watcher } = require("@ignis/server-core");
const bootstrapRoutes = require("../routes/bootstrap");

const {
  sessions,
  makeStorageName,
  PREFIX_SEPARATOR,
} = require("./demo-sessions");
const { recomputeBytes } = require("./demo-provision");

async function cleanupSession(sessionId) {
  const s = sessions.get(sessionId);

  if (!s) {
    return;
  }

  for (const userVaultName of s.vaults) {
    const storageName = makeStorageName(sessionId, userVaultName);
    const vaultPath = config.getVaultPath(storageName);

    if (!vaultPath) {
      continue;
    }

    try {
      await watcher.stopWatching(storageName);
    } catch {}

    try {
      await fsp.rm(vaultPath, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[demo] Failed to remove ${storageName}:`, e.message);
    }

    bootstrapRoutes.invalidateVault(storageName);
  }

  config.refreshVaults();
  sessions.delete(sessionId);

  console.log(`[demo] Cleaned up session ${sessionId}`);
}

async function cleanupExpired() {
  const now = Date.now();
  const expired = [];

  for (const [sessionId, s] of sessions) {
    if (now - s.lastActivity > config.demoTimeoutMs) {
      expired.push(sessionId);
    }
  }

  for (const sessionId of expired) {
    await cleanupSession(sessionId);
  }

  // Correct optimistic-quota drift for the sessions that remain (copyFile and mkdir add bytes the per-request quota gate does not count).
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const sessionId of [...sessions.keys()]) {
    await recomputeBytes(sessionId);
  }

  // Orphan scan: directories matching demo-* whose session is gone
  let entries;

  try {
    entries = await fsp.readdir(config.vaultRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("demo-")) {
      continue;
    }

    const idx = entry.name.indexOf(PREFIX_SEPARATOR);

    if (idx < 0) {
      continue;
    }

    const sessionId = entry.name.slice("demo-".length, idx);

    if (!sessions.has(sessionId)) {
      const orphanPath = path.join(config.vaultRoot, entry.name);

      try {
        await fsp.rm(orphanPath, { recursive: true, force: true });
        bootstrapRoutes.invalidateVault(entry.name);
        console.log(`[demo] Removed orphan ${entry.name}`);
      } catch {}
    }
  }

  config.refreshVaults();
}

module.exports = { cleanupSession, cleanupExpired };
