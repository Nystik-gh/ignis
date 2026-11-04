const OBSIDIAN_BACK_LAYERS =
  ".modal-container, .menu, .suggestion-container, .lightbox, .mobile-tab-switcher";

export function getBackAction(app) {
  const ignisOverlays = document.querySelectorAll(".modal-overlay");

  if (ignisOverlays.length > 0) {
    const topOverlay = ignisOverlays[ignisOverlays.length - 1];
    return () => topOverlay.dispatchEvent(new Event("ignis-back"));
  }

  if (document.querySelector(OBSIDIAN_BACK_LAYERS)) {
    if (hasObsidianHistoryBack()) {
      return () => history.back();
    }

    const target = document.activeElement || document.body;
    return () => pressEscape(target);
  }

  const drawer = findOpenDrawer(app);

  if (drawer) {
    return () => drawer.collapse();
  }

  const recentLeaf = app.workspace.getMostRecentLeaf();

  if (hasBackHistory(recentLeaf)) {
    return () => recentLeaf.history.back();
  }

  return null;
}

function hasObsidianHistoryBack() {
  return Object.prototype.hasOwnProperty.call(history, "back");
}

function hasBackHistory(leaf) {
  return (leaf?.history?.backHistory?.length ?? 0) > 0;
}

function findOpenDrawer(app) {
  if (!window.__ignis.obsidian?.Platform?.isMobile) {
    return null;
  }

  const { leftSplit, rightSplit } = app.workspace;

  return [leftSplit, rightSplit].find(
    (split) => split?.collapsed === false && !split.isPinned,
  );
}

function pressEscape(target) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}
