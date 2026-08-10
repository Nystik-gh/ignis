const fs = require("fs");
const path = require("path");
const config = require("./config");

// Runtime server settings set through UI.

const SETTINGS_FILE = path.join(config.dataRoot, "server-settings.json");

const DEFAULTS = {
  contentCacheBytes: 50 * 1024 * 1024,
  inputCacheBytes: 200 * 1024 * 1024,
  inputCacheTtlMs: 5 * 60 * 1000,
  writeCoalesceMs: 0,
  maxBodyBytes: 50 * 1024 * 1024,
  // "any" reaches any public host, "allowlist" restricts to proxyAllowlist, "disabled" blocks all proxying.
  proxyMode: "any",
  // Empty allows any public host.
  proxyAllowlist: [],
  // Hosts the browser fetches directly instead of through the proxy; they must send permissive CORS.
  directFetchHosts: [],
  wsOrigins: [],
  // Private IPs/CIDRs the proxy may reach despite the SSRF guard.
  proxyAllowPrivate: [],
};

const PROXY_MODES = ["any", "allowlist", "disabled"];

const KEYS = Object.keys(DEFAULTS);

// Env vars only; never persisted to the settings file.
const ENV_ONLY_KEYS = ["wsOrigins", "proxyAllowPrivate"];

// Hard ceiling for request bodies.
const MAX_BODY_BACKSTOP = 500 * 1024 * 1024;

// Hard ceiling for the coalesce window.
const MAX_WRITE_COALESCE_MS = 60000;

function parseList(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fromEnv() {
  const env = {};

  if (process.env.WRITE_COALESCE_MS !== undefined) {
    const n = parseInt(process.env.WRITE_COALESCE_MS, 10);

    if (Number.isFinite(n)) {
      env.writeCoalesceMs = n;
    }
  }

  if (process.env.WS_ORIGINS) {
    env.wsOrigins = parseList(process.env.WS_ORIGINS);
  }

  if (process.env.PROXY_ALLOW_PRIVATE_HOSTS) {
    env.proxyAllowPrivate = parseList(process.env.PROXY_ALLOW_PRIVATE_HOSTS);
  }

  return env;
}

const envOverrides = fromEnv();

function loadFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    // Keep only known keys so a stale or hand-edited file can't inject junk.
    const clean = {};

    for (const key of KEYS) {
      if (ENV_ONLY_KEYS.includes(key)) {
        continue;
      }

      if (parsed[key] !== undefined) {
        clean[key] = parsed[key];
      }
    }

    return clean;
  } catch {
    return {};
  }
}

let fileOverrides = loadFile();

function getAll() {
  return { ...DEFAULTS, ...envOverrides, ...fileOverrides };
}

function get(key) {
  return getAll()[key];
}

// Merge validated changes into the persisted file and return the new effective settings.
function update(partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (KEYS.includes(key) && !ENV_ONLY_KEYS.includes(key)) {
      fileOverrides[key] = value;
    }
  }

  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(fileOverrides, null, 2));

  return getAll();
}

module.exports = {
  DEFAULTS,
  KEYS,
  ENV_ONLY_KEYS,
  PROXY_MODES,
  MAX_BODY_BACKSTOP,
  MAX_WRITE_COALESCE_MS,
  getAll,
  get,
  update,
};
