import { setIcon } from "obsidian";
import { checkForUpdate } from "../update-check.js";
import * as serverSettings from "./server-settings.js";
import { numberField, listField } from "./server-setting-fields.js";
import { messageDefinition, blockDefinition } from "./settings-ui.js";

const GITHUB_URL = "https://github.com/Nystik-gh/ignis";

function getVersion() {
  return window.__ignis?.version || "unknown";
}

function settingDefinitions(tab) {
  return [
    { type: "group", cls: "ignis-plain", items: [blockDefinition(addHeader)] },
    {
      type: "group",
      cls: "ignis-plain",
      visible: () => !window.isSecureContext,
      items: [blockDefinition(addInsecureContextCallout)],
    },
    { type: "group", items: [serverStatusDefinition()] },
    ...serverSettingsGroups(tab),
  ];
}

function addHeader(containerEl) {
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
}

const REMOTE_ACCESS_DOCS_URL =
  "https://ignis.thiefling.com/docs/security/remote-access/#running-without-tls";

function addInsecureContextCallout(containerEl) {
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

function serverStatusDefinition() {
  return {
    name: "Server status",
    render: (setting) => {
      const ws = window.__ignis.ws;

      const dotEl = setting.controlEl.createEl("span", {
        cls: "ignis-status-dot",
      });

      const labelEl = setting.controlEl.createEl("span", {
        cls: "ignis-status-label",
      });

      function renderState(state) {
        dotEl.className = `ignis-status-dot ${STATUS_DOT_CLASSES[state] || STATUS_DOT_CLASSES.closed}`;
        labelEl.textContent = STATUS_LABELS[state] || STATUS_LABELS.closed;
      }

      renderState(ws.isOpen() ? "open" : "closed");

      return ws.onStateChange(renderState);
    },
  };
}

const MB = 1024 * 1024;
const MINUTE = 60 * 1000;

function serverSettingsGroups(tab) {
  if (!serverSettings.get()) {
    return [
      {
        type: "group",
        items: [
          messageDefinition(
            serverSettings.loadFailed()
              ? "Failed to load server settings."
              : "Loading server settings...",
          ),
        ],
      },
    ];
  }

  return [
    {
      type: "group",
      heading: "Caching",
      items: [
        numberField({
          name: "Content cache (MB)",
          desc: "Browser cache of file content. Applies after reload.",
          key: "contentCacheBytes",
          fromStored: (bytes) => Math.round(bytes / MB),
          toStored: (n) => n * MB,
        }),
        numberField({
          name: "Input cache (MB)",
          desc: "Cache for files picked for import. Applies after reload.",
          key: "inputCacheBytes",
          fromStored: (bytes) => Math.round(bytes / MB),
          toStored: (n) => n * MB,
        }),
        numberField({
          name: "Input cache TTL (minutes)",
          desc: "How long picked files stay cached. Applies after reload.",
          key: "inputCacheTtlMs",
          fromStored: (ms) => Math.round(ms / MINUTE),
          toStored: (n) => n * MINUTE,
        }),
      ],
    },
    {
      type: "group",
      heading: "Security",
      items: [
        numberField({
          name: "Max request body (MB)",
          desc: "Largest request the server accepts.",
          key: "maxBodyBytes",
          fromStored: (bytes) => Math.round(bytes / MB),
          toStored: (n) => n * MB,
        }),
        ...proxyAccessFields(tab),
        listField(tab, {
          name: "Direct-fetch hosts",
          desc: "Hosts the browser fetches directly, bypassing the proxy. Only for hosts that allow cross-origin browser requests (CORS);  everything else goes through the proxy. Applies after reload.",
          key: "directFetchHosts",
          modal: {
            placeholder: "api.example.com",
            emptyNote: "No hosts yet.",
          },
        }),
      ],
    },
    {
      type: "group",
      heading: "Advanced",
      items: [
        numberField({
          name: "Write coalesce window (ms)",
          desc: "Debounce window for rapid writes on slow filesystems. 0 disables. Maximum 60000.",
          key: "writeCoalesceMs",
          fromStored: (n) => n,
          toStored: (n) => n,
        }),
        ignoreRulesField(),
      ],
    },
  ];
}

function getProxyMode() {
  return serverSettings.get().proxyMode || "any";
}

// Proxy access mode plus the allowlist row, which only shows in "allowlist" mode.
function proxyAccessFields(tab) {
  const accessField = {
    name: "Proxy access",
    desc: "Which external hosts Obsidian may reach through the server's CORS proxy.",
    render: (setting) => {
      setting.addDropdown((dd) => {
        dd.addOption("any", "Any public host");
        dd.addOption("allowlist", "Allowlist only");
        dd.addOption("disabled", "Disabled");
        dd.setValue(getProxyMode());

        dd.onChange(async (value) => {
          await serverSettings.save({ proxyMode: value });
          tab.refreshDomState();
        });
      });
    },
  };

  const allowlistField = listField(tab, {
    name: "Proxy host allowlist",
    desc: "Hostnames the proxy may reach, matched exactly.",
    key: "proxyAllowlist",
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

  return [
    accessField,
    { ...allowlistField, visible: () => getProxyMode() === "allowlist" },
  ];
}

function ignoreRulesField() {
  return {
    name: "Ignored paths",
    desc: createFragment((frag) => {
      frag.appendText(
        "Rules for paths to ignore when watching for file changes. Ignored paths still appear in the vault and can be manually refreshed. Uses gitignore patterns ",
      );
      frag.createEl("a", {
        text: "Learn more",
        href: "https://ignis.thiefling.com/docs/performance/#ignored-paths",
        attr: { target: "_blank", rel: "noopener noreferrer" },
      });
    }),
    render: (setting) => {
      const current = serverSettings.get();
      let rules = current.ignoreRules;

      const setLabel = (btn) =>
        btn.setButtonText(rules.length ? `Edit (${rules.length})` : "Edit");

      setting.addButton((btn) => {
        setLabel(btn);

        btn.onClick(() => {
          openIgnoreRulesEditor({
            rules,
            suggestions: current.ignoreSuggestions,
            onChange: async (edited) => {
              rules = edited;
              setLabel(btn);
              await serverSettings.save({ ignoreRules: edited });
            },
          });
        });
      });
    },
  };
}

function openIgnoreRulesEditor(opts) {
  const component = new window.IgnisUI.IgnoreRulesEditor({
    // mount to settings modal to avoid focus issues
    target: document.querySelector(".modal-container") || document.body,
    props: {
      rules: opts.rules,
      suggestions: opts.suggestions,
    },
  });

  component.$on("change", (event) => {
    opts.onChange(event.detail);
  });

  component.$on("close", () => {
    component.$destroy();
  });
}

export { settingDefinitions };
