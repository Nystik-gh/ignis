import { fsShim } from "./fs/index.js";
import {
  registerPathResolver,
  registerReadTransform,
  registerWriteTransform,
} from "./fs/transforms.js";

const WORKSPACE_PATH = ".obsidian/workspace.json";
const WORKSPACES_PATH = ".obsidian/workspaces.json";

// A workspace name from the URL flows into the per-workspace state-file path, so constrain it.
export function isValidWorkspaceName(name) {
  return /^[A-Za-z0-9 _.-]{1,64}$/.test(name);
}

// Redirect workspace.json to a per-name file when a workspace is active in this tab.
registerPathResolver(
  (path) => path === WORKSPACE_PATH && !!window.__workspaceName,
  () => `.obsidian/workspace.${window.__workspaceName}.json`,
);

// Keep workspaces.json's active field at the canonical value on disk so other tabs see a stable state.
registerWriteTransform(WORKSPACES_PATH, (content) => {
  const original = window.__originalActiveWorkspace;

  if (!original || !window.__workspaceName) {
    return content;
  }

  if (typeof content !== "string") {
    return content;
  }

  try {
    const parsed = JSON.parse(content);

    if (parsed.active !== original) {
      parsed.active = original;
      return JSON.stringify(parsed);
    }
  } catch {}

  return content;
});

function setWorkspaceParam(name) {
  const url = new URL(window.location.href);

  if (name) {
    url.searchParams.set("workspace", name);
  } else {
    url.searchParams.delete("workspace");
  }

  history.replaceState(history.state, "", url.toString());
}

// When ?load=preset is set, copy the named preset from workspaces.json into this tab's per-workspace state file.
// This overwrites any stale state from a prior session.
// Then strip the param so a page reload doesn't keep resetting.
export function loadPresetIfRequested() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.get("load") !== "preset" || !window.__workspaceName) {
    return;
  }

  try {
    const presetsText = fsShim.readFileSync(WORKSPACES_PATH, "utf-8");
    const presets = JSON.parse(presetsText);
    const preset =
      presets.workspaces && presets.workspaces[window.__workspaceName];

    if (!preset) {
      console.warn(
        "[ignis] load=preset requested but no preset found for:",
        window.__workspaceName,
      );
      return;
    }

    // Path resolver routes this write to workspace.<name>.json.
    fsShim.writeFileSync(WORKSPACE_PATH, JSON.stringify(preset), "utf-8");
    console.log("[ignis] Loaded preset for workspace:", window.__workspaceName);
  } catch (e) {
    console.warn("[ignis] Failed to load preset:", e);
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.delete("load");
    history.replaceState(history.state, "", url.toString());
  }
}

function readJsonIfPresent(path) {
  try {
    return JSON.parse(fsShim.readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function resolveWorkspaceName() {
  // With no URL param, only resolve a workspace when the workspaces core plugin is enabled.
  if (!window.__workspaceName) {
    const corePlugins = readJsonIfPresent(".obsidian/core-plugins.json");

    if (!corePlugins || !corePlugins.workspaces) {
      return;
    }
  }

  const workspaces = readJsonIfPresent(WORKSPACES_PATH);

  if (!workspaces) {
    return;
  }

  // Keep the original active value so the write transform can restore it on disk.
  if (workspaces.active) {
    window.__originalActiveWorkspace = workspaces.active;
  }

  // With no URL param, seed from the active workspace.
  if (!window.__workspaceName && workspaces.active) {
    window.__workspaceName = workspaces.active;
    setWorkspaceParam(workspaces.active);
    console.log("[ignis] Workspace resolved from active:", workspaces.active);
  }
}

export function initWorkspacePatch() {
  const observer = new MutationObserver(() => {
    if (!document.querySelector(".workspace")) {
      return;
    }

    const plugin =
      window.app &&
      window.app.internalPlugins &&
      window.app.internalPlugins.plugins &&
      window.app.internalPlugins.plugins.workspaces;

    if (!plugin || !plugin.enabled || !plugin.instance) {
      return;
    }

    observer.disconnect();

    const instance = plugin.instance;
    const origLoad = instance.loadWorkspace.bind(instance);
    const origSave = instance.saveWorkspace.bind(instance);

    instance.loadWorkspace = function (name) {
      window.__workspaceName = name;
      setWorkspaceParam(name);
      fsShim.invalidate(WORKSPACE_PATH);
      return origLoad(name);
    };

    instance.saveWorkspace = function (name) {
      // Grab the current layout before changing __workspaceName.
      let currentLayout = null;

      try {
        currentLayout = fsShim.readFileSync(WORKSPACE_PATH, "utf-8");
      } catch {}

      window.__workspaceName = name;
      setWorkspaceParam(name);
      fsShim.invalidate(WORKSPACE_PATH);
      const result = origSave(name);

      // Write the layout to the new workspace file so it exists on disk immediately.
      if (currentLayout) {
        fsShim.writeFileSync(WORKSPACE_PATH, currentLayout, "utf-8");
      }

      return result;
    };

    // Override the active field on reads so the menu matches this tab's workspace.
    registerReadTransform(WORKSPACES_PATH, (data) => {
      if (!window.__workspaceName) {
        return data;
      }

      let text =
        typeof data === "string" ? data : new TextDecoder().decode(data);

      try {
        const parsed = JSON.parse(text);

        if (parsed.active !== window.__workspaceName) {
          parsed.active = window.__workspaceName;
          return JSON.stringify(parsed);
        }
      } catch {}

      return data;
    });

    // Relay watcher events for workspaces.json to the plugin's config change handler,
    // so creating/deleting workspaces in one tab updates the menu in other tabs.
    fsShim.watch(".obsidian", (eventType, filename) => {
      if (filename === "workspaces.json") {
        plugin.loadData().then((data) => {
          if (data) {
            instance.workspaces = data.workspaces || {};
          }
        });
      }
    });

    console.log(
      "[ignis] Workspaces plugin patched, workspace:",
      window.__workspaceName || "(none)",
    );
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
