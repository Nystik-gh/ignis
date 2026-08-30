import { Notice } from "obsidian";

let refreshInFlight = false;

async function requestRefresh() {
  const res = await fetch(
    new URL("/api/vault/refresh", window.location.origin).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault: window.__ignis?.vault?.id || "" }),
    },
  );

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText, code: "UNKNOWN" }));
    const e = new Error(err.error || res.statusText);
    e.code = err.code || "UNKNOWN";
    e.status = res.status;
    e.retryAfterMs = err.retryAfterMs;
    throw e;
  }

  return res.json();
}

function formatRefreshError(e) {
  if (e?.status === 429 && Number.isFinite(e.retryAfterMs)) {
    return `Refresh vault from disk is cooling down. Try again in ${Math.ceil(
      e.retryAfterMs / 1000,
    )}s.`;
  }

  return e?.message || "Refresh vault from disk failed.";
}

export function registerVaultRefreshCommand(plugin) {
  plugin.addCommand({
    id: "refresh-vault-from-disk",
    name: "Refresh vault from disk",
    callback: async () => {
      if (refreshInFlight) {
        new Notice("Refresh vault from disk is already running.");
        return;
      }

      refreshInFlight = true;

      try {
        const result = await requestRefresh();
        new Notice(
          `Vault refreshed from disk (${result.files} files, ${result.directories} folders).`,
        );
      } catch (e) {
        new Notice(formatRefreshError(e));
      } finally {
        refreshInFlight = false;
      }
    },
  });
}
