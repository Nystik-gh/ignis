const BASE = "/api/ext/git-backup";

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

function getStatus(vaultId) {
  return fetchJson(`/status?vaultId=${encodeURIComponent(vaultId)}`);
}

function setConfig(vaultId, intervalSeconds) {
  return post("/config", { vaultId, intervalSeconds });
}

function backup(vaultId) {
  return post("/backup", { vaultId });
}

module.exports = { getStatus, setConfig, backup };
