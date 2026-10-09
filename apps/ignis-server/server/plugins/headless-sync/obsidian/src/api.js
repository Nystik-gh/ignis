const BASE = "/api/ext/headless-sync";

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

function post(path, body) {
  return fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getStatus() {
  return fetchJson("/status");
}

function login(token, email, name) {
  return post("/login", { token, email, name });
}

function logout() {
  return post("/logout", {});
}

function getRemoteVaults() {
  return fetchJson("/remote-vaults");
}

function setupSync(vaultId, remoteVault, opts = {}) {
  return post("/setup", { vaultId, remoteVault, ...opts });
}

function createRemoteVault(name, encryption, password, region) {
  return post("/create-remote-vault", { name, encryption, password, region });
}

function setConfig(vaultId, syncConfig) {
  return post("/config", { vaultId, ...syncConfig });
}

function startSync(vaultId) {
  return post("/start", { vaultId });
}

function stopSync(vaultId) {
  return post("/stop", { vaultId });
}

function unlinkVault(vaultId) {
  return post("/unlink", { vaultId });
}

function getVaults() {
  return fetchJson("/vaults");
}

function getLogs(vaultId, limit = 100) {
  return fetchJson(
    `/logs?vaultId=${encodeURIComponent(vaultId)}&limit=${limit}`,
  );
}

module.exports = {
  getStatus,
  login,
  logout,
  getRemoteVaults,
  setupSync,
  createRemoteVault,
  setConfig,
  startSync,
  stopSync,
  unlinkVault,
  getVaults,
  getLogs,
};
