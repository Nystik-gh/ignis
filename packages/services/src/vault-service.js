const API_BASE = "/api/vault";

async function fetchJson(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || "Request failed");
  }

  return res.json();
}

export const vaultService = {
  getCurrentVaultId() {
    return window.__currentVaultId || "";
  },

  async listVaults() {
    const list = await fetchJson(API_BASE + "/list");

    window.__vaultList = list;

    return list;
  },

  listVaultsSync() {
    const xhr = new XMLHttpRequest();

    xhr.open("GET", API_BASE + "/list", false);
    xhr.send();

    if (xhr.status === 200) {
      const list = JSON.parse(xhr.responseText);

      window.__vaultList = list;

      return list;
    }

    return [];
  },

  async createVault(name) {
    await fetchJson(API_BASE + "/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    this._setVaultTrust(name);

    return this.listVaults();
  },

  createVaultSync(name) {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", API_BASE + "/create", false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ name }));

    if (xhr.status >= 400) {
      return null;
    }

    return true;
  },

  async renameVault(id, newName) {
    await fetchJson(API_BASE + "/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault: id, name: newName }),
    });

    this._migrateLocalStorage(id, newName);

    if (id === this.getCurrentVaultId()) {
      window.__currentVaultId = newName;

      if (window.__vaultConfig) {
        window.__vaultConfig.id = newName;
      }

      history.replaceState(null, "", "/?vault=" + encodeURIComponent(newName));
    }

    return this.listVaults();
  },

  async deleteVault(id) {
    await fetchJson(API_BASE + "/remove?vault=" + encodeURIComponent(id), {
      method: "DELETE",
    });

    const wasCurrentVault = id === this.getCurrentVaultId();

    await this.listVaults();

    return { wasCurrentVault };
  },

  deleteVaultSync(id) {
    const xhr = new XMLHttpRequest();

    xhr.open(
      "DELETE",
      API_BASE + "/remove?vault=" + encodeURIComponent(id),
      false,
    );

    xhr.send();

    return xhr.status < 400;
  },

  openVault(id) {
    localStorage.setItem("last-vault", id);

    const target = window.parent !== window ? window.parent : window;

    target.location.href = "/?vault=" + encodeURIComponent(id);
  },

  _setVaultTrust(vaultId, trusted = true) {
    localStorage.setItem("enable-plugin-" + vaultId, String(trusted));
  },

  _migrateLocalStorage(oldId, newId) {
    const pluginKey = "enable-plugin-";

    const oldVal = localStorage.getItem(pluginKey + oldId);

    if (oldVal !== null) {
      localStorage.setItem(pluginKey + newId, oldVal);
      localStorage.removeItem(pluginKey + oldId);
    }

    if (localStorage.getItem("last-vault") === oldId) {
      localStorage.setItem("last-vault", newId);
    }
  },
};
