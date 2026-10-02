import {
  registerReadTransform,
  registerWriteTransform,
} from "../fs/transforms.js";

const WORKSPACES_PATH = ".obsidian/workspaces.json";

const LAYOUT_PATH = /^\.obsidian\/workspace(\.[^/]+)?\.json$/;

const NOTICE_TEXT = "Pop-out windows aren't available in the browser.";

const floatingByPath = new Map();
const floatingByPreset = new Map();

let noticeShown = false;

export function isLayoutPath(path) {
  return LAYOUT_PATH.test(path);
}

function parse(data) {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);

  return JSON.parse(text);
}

function holdsWindow(floating) {
  return (
    !!floating &&
    Array.isArray(floating.children) &&
    floating.children.length > 0
  );
}

function detachFloating(layout) {
  const floating = layout.floating;

  delete layout.floating;

  return holdsWindow(floating) ? floating : undefined;
}

function remember(map, key, floating) {
  if (floating) {
    map.set(key, floating);
  } else {
    map.delete(key);
  }
}

function stripLayoutFile(data, path) {
  const layout = parse(data);

  remember(floatingByPath, path, detachFloating(layout));

  return JSON.stringify(layout);
}

function restoreLayoutFile(data, path) {
  const floating = floatingByPath.get(path);

  if (!floating) {
    return data;
  }

  const layout = parse(data);
  layout.floating = floating;

  return JSON.stringify(layout, null, 2);
}

function stripPresets(data) {
  const parsed = parse(data);
  const presets = parsed.workspaces;

  floatingByPreset.clear();

  if (!presets || typeof presets !== "object") {
    return data;
  }

  for (const [name, preset] of Object.entries(presets)) {
    if (preset && typeof preset === "object") {
      remember(floatingByPreset, name, detachFloating(preset));
    }
  }

  return JSON.stringify(parsed);
}

function restorePresets(data) {
  if (floatingByPreset.size === 0) {
    return data;
  }

  const parsed = parse(data);
  const presets = parsed.workspaces;

  if (!presets || typeof presets !== "object") {
    return data;
  }

  for (const [name, floating] of floatingByPreset) {
    if (presets[name] && typeof presets[name] === "object") {
      presets[name].floating = floating;
    }
  }

  return JSON.stringify(parsed, null, 2);
}

export function initPopoutGuard() {
  floatingByPath.clear();
  floatingByPreset.clear();

  registerReadTransform(isLayoutPath, stripLayoutFile);
  registerWriteTransform(isLayoutPath, restoreLayoutFile);
  registerReadTransform(WORKSPACES_PATH, stripPresets);
  registerWriteTransform(WORKSPACES_PATH, restorePresets);
}

function notify(Notice) {
  if (noticeShown) {
    return;
  }

  noticeShown = true;
  new Notice(NOTICE_TEXT);
}

export function installPopoutOverrides(obsidian) {
  const { Workspace, Platform, Notice } = obsidian;

  noticeShown = false;

  Object.defineProperty(Platform, "canPopoutWindow", {
    get: () => false,
    configurable: true,
  });

  const proto = Workspace.prototype;

  proto.isWorkspaceFocused = function () {
    return true;
  };

  proto.moveLeafToPopout = function () {
    notify(Notice);
  };

  proto.openPopoutLeaf = function () {
    notify(Notice);

    return this.getLeaf("tab");
  };

  proto.openPopout = function () {
    notify(Notice);

    return this.rootSplit;
  };
}
