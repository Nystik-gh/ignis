import { MarkdownView } from "obsidian";
import { enterReadingMode } from "./view-mode.js";

// Warm opens settle before this fires, so only network reads ever show the affordance.
const AFFORDANCE_DELAY_MS = 80;

let patched = false;
let originalOnLoadFile = null;

// Blocks input while the content read pends.
function beginGate(view) {
  const token = (view._ignisGateToken || 0) + 1;
  view._ignisGateToken = token;

  // drop any existing gate.
  teardownGate(view);

  const contentEl = view.contentEl || null;

  const blocker = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  if (contentEl) {
    // intercept before codemirror.
    contentEl.addEventListener("beforeinput", blocker, true);
  }

  const timer = setTimeout(() => {
    if (view._ignisGateToken !== token) {
      return;
    }

    if (contentEl) {
      contentEl.classList.add("ignis-loading");
    }

    const gate = view._ignisGate;

    if (gate) {
      gate.restoreMode = enterReadingMode(view);
    }
  }, AFFORDANCE_DELAY_MS);

  view._ignisGate = { contentEl, blocker, timer, restoreMode: null };

  return token;
}

function teardownGate(view) {
  const gate = view._ignisGate;

  if (!gate) {
    return;
  }

  clearTimeout(gate.timer);

  if (gate.contentEl) {
    gate.contentEl.removeEventListener("beforeinput", gate.blocker, true);
    gate.contentEl.classList.remove("ignis-loading");
  }

  if (gate.restoreMode) {
    gate.restoreMode();
  }

  view._ignisGate = null;
}

function endGate(view, token) {
  // A stale settle must not tear down a newer load's gate.
  if (view._ignisGateToken !== token) {
    return;
  }

  teardownGate(view);
}

export function installLoadingGate() {
  if (
    patched ||
    typeof MarkdownView !== "function" ||
    !MarkdownView.prototype
  ) {
    return () => {};
  }

  originalOnLoadFile = MarkdownView.prototype.onLoadFile;

  if (typeof originalOnLoadFile !== "function") {
    return () => {};
  }

  MarkdownView.prototype.onLoadFile = async function (file) {
    const token = beginGate(this);

    try {
      return await originalOnLoadFile.apply(this, arguments);
    } finally {
      endGate(this, token);
    }
  };

  patched = true;

  return uninstallLoadingGate;
}

export function uninstallLoadingGate() {
  if (!patched) {
    return;
  }

  // Restore the original method.
  delete MarkdownView.prototype.onLoadFile;

  patched = false;
  originalOnLoadFile = null;
}
