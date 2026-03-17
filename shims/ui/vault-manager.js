// Custom vault manager modal. will migrate to Svelte later

export function showVaultManager() {
  if (!document.querySelector(".workspace")) return;
  if (document.getElementById("ignis-starter-modal")) return;

  const overlay = document.createElement("div");
  overlay.id = "ignis-starter-modal";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);" +
    "display:flex;align-items:center;justify-content:center;font-family:var(--font-interface);";

  const modal = document.createElement("div");
  modal.style.cssText =
    "background:var(--background-primary);color:var(--text-normal);border-radius:12px;" +
    "padding:24px;width:min(480px,90vw);max-height:80vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.4);";

  const title = document.createElement("h2");
  title.textContent = "Vaults";
  title.style.cssText = "margin:0 0 16px 0;font-size:18px;font-weight:600;";
  modal.appendChild(title);

  const listEl = document.createElement("div");
  listEl.style.cssText =
    "display:flex;flex-direction:column;gap:4px;margin-bottom:16px;";
  modal.appendChild(listEl);

  function renderList() {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/vault/list", false);
    xhr.send();
    const vaults = xhr.status === 200 ? JSON.parse(xhr.responseText) : [];
    listEl.innerHTML = "";
    if (vaults.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No vaults yet. Create one below.";
      empty.style.cssText = "color:var(--text-muted);padding:12px 0;";
      listEl.appendChild(empty);
      return;
    }
    for (const v of vaults) {
      const isCurrent = v.id === (window.__currentVaultId || "");

      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "padding:8px 12px;border-radius:6px;cursor:pointer;" +
        "background:var(--background-secondary);";
      row.addEventListener(
        "mouseenter",
        () => (row.style.background = "var(--background-modifier-hover)"),
      );
      row.addEventListener(
        "mouseleave",
        () => (row.style.background = "var(--background-secondary)"),
      );

      const name = document.createElement("span");
      name.textContent = v.name;
      name.style.cssText = "font-weight:500;flex:1;";
      if (isCurrent) {
        const badge = document.createElement("span");
        badge.textContent = " current";
        badge.style.cssText =
          "font-size:11px;color:var(--text-muted);font-weight:400;";
        name.appendChild(badge);
      }

      const del = document.createElement("button");
      del.textContent = "Delete";
      del.style.cssText =
        "background:none;border:1px solid var(--background-modifier-border);" +
        "color:var(--text-muted);border-radius:4px;padding:2px 8px;font-size:12px;cursor:pointer;";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm('Delete vault "' + v.name + '"? This removes all files.'))
          return;
        const xhr2 = new XMLHttpRequest();
        xhr2.open(
          "DELETE",
          "/api/vault/remove?vault=" + encodeURIComponent(v.id),
          false,
        );
        xhr2.send();
        renderList();
        if (isCurrent) window.location.href = "/";
      });

      row.addEventListener("click", () => {
        if (isCurrent) {
          overlay.remove();
          return;
        }
        window.location.href = "/?vault=" + encodeURIComponent(v.id);
      });

      row.appendChild(name);
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  renderList();

  const form = document.createElement("div");
  form.style.cssText = "display:flex;gap:8px;";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "New vault name...";
  input.style.cssText =
    "flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);" +
    "background:var(--background-secondary);color:var(--text-normal);font-size:14px;outline:none;";

  const btn = document.createElement("button");
  btn.textContent = "Create";
  btn.style.cssText =
    "padding:6px 16px;border-radius:6px;border:none;" +
    "background:var(--interactive-accent);color:var(--text-on-accent);font-size:14px;cursor:pointer;font-weight:500;";

  function createVault() {
    const name = input.value.trim();
    if (!name) return;
    const xhr3 = new XMLHttpRequest();
    xhr3.open("POST", "/api/vault/create", false);
    xhr3.setRequestHeader("Content-Type", "application/json");
    xhr3.send(JSON.stringify({ name }));
    if (xhr3.status >= 400) {
      alert(
        "Failed to create vault: " +
          (JSON.parse(xhr3.responseText).error || "Unknown error"),
      );
      return;
    }
    input.value = "";
    window.location.href = "/?vault=" + encodeURIComponent(name);
  }

  btn.addEventListener("click", createVault);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createVault();
  });

  form.appendChild(input);
  form.appendChild(btn);
  modal.appendChild(form);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.remove();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  input.focus();
}
