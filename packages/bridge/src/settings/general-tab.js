import { Setting, Notice, setIcon } from "obsidian";
import { isDemoMode } from "../demo-guards.js";
import { stripBuildMetadata, isNewer } from "../util/version.js";
import { ListEditorModal } from "./list-editor-modal.js";

const GITHUB_URL = "https://github.com/Nystik-gh/ignis";
const GITHUB_API_LATEST =
  "https://api.github.com/repos/Nystik-gh/ignis/releases/latest";

function getVersion() {
  return window.__ignis?.version || "unknown";
}

async function checkForUpdate(currentVersion) {
  try {
    const res = await fetch(GITHUB_API_LATEST);

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const latest = stripBuildMetadata(data.tag_name?.replace(/^v/, ""));
    const current = stripBuildMetadata(currentVersion);

    if (isNewer(latest, current)) {
      return { version: latest, url: data.html_url };
    }

    return null;
  } catch {
    return null;
  }
}

function display(containerEl, app) {
  const version = getVersion();

  const header = containerEl.createDiv("ignis-header");

  header.createEl("img", {
    cls: "ignis-header-logo",
    attr: { src: "/assets/ignis.webp", alt: "Ignis" },
  });

  const info = header.createDiv("ignis-header-info");
  info.createEl("div", { text: "Ignis", cls: "ignis-header-title" });
  info.createEl("div", {
    text: "Obsidian server bridge",
    cls: "ignis-header-subtitle",
  });

  const right = header.createDiv("ignis-header-right");

  const versionCol = right.createDiv("ignis-header-version-col");
  versionCol.createEl("span", {
    text: `Version ${version}`,
    cls: "ignis-header-version",
  });

  const updateIndicator = versionCol.createEl("a", {
    text: "Checking...",
    cls: "ignis-update-indicator",
    attr: { target: "_blank", rel: "noopener noreferrer" },
  });

  const githubLink = right.createEl("a", {
    cls: "ignis-github-link",
    href: GITHUB_URL,
    attr: { target: "_blank", "aria-label": "GitHub" },
  });

  githubLink.createEl("img", {
    cls: "ignis-github-icon",
    attr: { src: "/assets/github.svg", alt: "GitHub" },
  });

  checkForUpdate(version).then((latest) => {
    if (latest) {
      updateIndicator.textContent = `v${latest.version} available`;
      updateIndicator.addClass("ignis-update-available");
      updateIndicator.href = latest.url;
    } else {
      updateIndicator.textContent = "Up to date";
    }
  });

  addInsecureContextCallout(containerEl);
  addServerStatus(containerEl);
  addServerSettings(containerEl, app);
}

const REMOTE_ACCESS_DOCS_URL =
  "https://ignis.thiefling.com/docs/security/remote-access/#running-without-tls";

function addInsecureContextCallout(containerEl) {
  if (window.isSecureContext) {
    return;
  }

  const callout = containerEl.createDiv("ignis-insecure-callout");

  const icon = callout.createDiv("ignis-insecure-callout-icon");
  setIcon(icon, "alert-triangle");

  const text = callout.createDiv("ignis-insecure-callout-text");
  text.createEl("div", {
    text: "Insecure connection",
    cls: "ignis-insecure-callout-title",
  });

  const body = text.createEl("div", { cls: "ignis-insecure-callout-body" });
  body.appendText(
    "The browser disables some APIs on insecure pages, so parts of Obsidian do not work here. ",
  );
  body.createEl("a", {
    text: "Serving Ignis over HTTPS",
    href: REMOTE_ACCESS_DOCS_URL,
    attr: { target: "_blank", rel: "noopener noreferrer" },
  });
  body.appendText(" restores them.");
}

const STATUS_LABELS = {
  open: "Connected",
  connecting: "Connecting...",
  closed: "Disconnected",
};

const STATUS_DOT_CLASSES = {
  open: "ignis-status-connected",
  connecting: "ignis-status-connecting",
  closed: "ignis-status-disconnected",
};

function createSettingGroup(containerEl, heading) {
  const group = containerEl.createDiv("setting-group");

  if (heading) {
    new Setting(group).setName(heading).setHeading();
  }

  return group.createDiv("setting-items");
}

function addServerStatus(containerEl) {
  const ws = window.__ignis.ws;

  const items = createSettingGroup(containerEl);

  const setting = new Setting(items).setName("Server status");

  const dotEl = setting.controlEl.createEl("span", {
    cls: "ignis-status-dot",
  });

  const labelEl = setting.controlEl.createEl("span", {
    cls: "ignis-status-label",
  });

  function render(state) {
    dotEl.className = `ignis-status-dot ${STATUS_DOT_CLASSES[state] || STATUS_DOT_CLASSES.closed}`;
    labelEl.textContent = STATUS_LABELS[state] || STATUS_LABELS.closed;
  }

  render(ws.isOpen() ? "open" : "closed");

  const unsub = ws.onStateChange(render);

  // Detach when the settings tab DOM goes away.
  const observer = new MutationObserver(() => {
    if (!containerEl.isConnected) {
      unsub();
      observer.disconnect();
    }
  });

  observer.observe(containerEl.parentElement || document.body, {
    childList: true,
    subtree: true,
  });
}

const MB = 1024 * 1024;
const MINUTE = 60 * 1000;

function addServerSettings(containerEl, app) {
  if (isDemoMode()) {
    const items = createSettingGroup(containerEl);

    new Setting(items)
      .setName("Server settings")
      .setDesc("Server settings are disabled in demo mode.");
    return;
  }

  const loading = containerEl.createEl("p", {
    text: "Loading server settings...",
    cls: "setting-item-description",
  });

  fetch("/api/settings")
    .then((res) => (res.ok ? res.json() : Promise.reject(res)))
    .then((current) => {
      loading.remove();
      renderServerSettings(containerEl, current, app);
    })
    .catch(() => {
      loading.setText("Failed to load server settings.");
    });
}

function renderServerSettings(containerEl, current, app) {
  const caching = createSettingGroup(containerEl, "Caching");

  numberField(caching, {
    name: "Content cache (MB)",
    desc: "Browser cache of file content. Applies after reload.",
    value: Math.round(current.contentCacheBytes / MB),
    key: "contentCacheBytes",
    toStored: (n) => n * MB,
  });

  numberField(caching, {
    name: "Input cache (MB)",
    desc: "Cache for files picked for import. Applies after reload.",
    value: Math.round(current.inputCacheBytes / MB),
    key: "inputCacheBytes",
    toStored: (n) => n * MB,
  });

  numberField(caching, {
    name: "Input cache TTL (minutes)",
    desc: "How long picked files stay cached. Applies after reload.",
    value: Math.round(current.inputCacheTtlMs / MINUTE),
    key: "inputCacheTtlMs",
    toStored: (n) => n * MINUTE,
  });

  const security = createSettingGroup(containerEl, "Security");

  numberField(security, {
    name: "Max request body (MB)",
    desc: "Largest request the server accepts.",
    value: Math.round(current.maxBodyBytes / MB),
    key: "maxBodyBytes",
    toStored: (n) => n * MB,
  });

  proxyAccessField(security, current, app);

  listField(security, {
    name: "Direct-fetch hosts",
    desc: "Hosts the browser fetches directly, bypassing the proxy. Only for hosts that allow cross-origin browser requests (CORS);  everything else goes through the proxy. Applies after reload.",
    value: current.directFetchHosts,
    key: "directFetchHosts",
    app,
    modal: {
      placeholder: "api.example.com",
      emptyNote: "No hosts yet.",
    },
  });

  const advanced = createSettingGroup(containerEl, "Advanced");

  numberField(advanced, {
    name: "Write coalesce window (ms)",
    desc: "Debounce window for rapid writes on slow filesystems. 0 disables.",
    value: current.writeCoalesceMs,
    key: "writeCoalesceMs",
    toStored: (n) => n,
  });
}

// Persist a single setting. The server validates, applies the live ones, and saves.
async function saveSetting(partial) {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Save failed");
    }
  } catch (e) {
    new Notice(`Failed to save setting: ${e.message}`);
  }
}

function numberField(containerEl, { name, desc, value, key, toStored }) {
  let committed = value;

  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => {
      text.setValue(String(value));

      // Commit only on change.
      const commit = () => {
        const n = parseInt(text.getValue(), 10);

        if (!Number.isInteger(n) || n < 0 || n === committed) {
          return;
        }

        committed = n;
        saveSetting({ [key]: toStored(n) });
      };

      text.inputEl.addEventListener("blur", commit);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          commit();
        }
      });
    });
}

// Proxy access mode plus the allowlist row, which only shows in "allowlist" mode.
function proxyAccessField(parent, current, app) {
  let mode = current.proxyMode || "any";

  const setting = new Setting(parent)
    .setName("Proxy access")
    .setDesc(
      "Which external hosts Obsidian may reach through the server's CORS proxy.",
    );

  const allowlistSetting = listField(parent, {
    name: "Proxy host allowlist",
    desc: "Hostnames the proxy may reach, matched exactly.",
    value: current.proxyAllowlist,
    key: "proxyAllowlist",
    app,
    modal: {
      placeholder: "api.example.com",
      emptyNote: "No hosts yet.",
      recommended: {
        note: "Restricting the proxy stops Obsidian's plugin and theme browser and updates from working unless their hosts are allowed.",
        hosts: [
          "releases.obsidian.md",
          "github.com",
          "api.github.com",
          "raw.githubusercontent.com",
        ],
        buttonText: "Add recommended hosts",
      },
    },
  });

  const applyVisibility = () => {
    allowlistSetting.settingEl.style.display =
      mode === "allowlist" ? "" : "none";
  };

  setting.addDropdown((dd) => {
    dd.addOption("any", "Any public host");
    dd.addOption("allowlist", "Allowlist only");
    dd.addOption("disabled", "Disabled");
    dd.setValue(mode);

    dd.onChange((value) => {
      mode = value;
      saveSetting({ proxyMode: value });
      applyVisibility();
    });
  });

  applyVisibility();
}

function listField(containerEl, { name, desc, value, key, app, modal }) {
  let current = [...(value || [])];

  const setting = new Setting(containerEl).setName(name).setDesc(desc);

  const setLabel = (btn) =>
    btn.setButtonText(current.length ? `Edit (${current.length})` : "Edit");

  setting.addButton((btn) => {
    setLabel(btn);

    btn.onClick(() => {
      new ListEditorModal(app, {
        title: name,
        placeholder: modal.placeholder,
        emptyNote: modal.emptyNote,
        recommended: modal.recommended,
        values: current,
        onChange: (next) => {
          current = next;
          saveSetting({ [key]: current });
          setLabel(btn);
        },
      }).open();
    });
  });

  return setting;
}

export { display };
