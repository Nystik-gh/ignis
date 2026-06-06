const STATUS_LABELS = {
  open: "Ignis server: Connected",
  connecting: "Ignis server: Connecting...",
  closed: "Ignis server: Disconnected",
};

const STATUS_DOT_CLASSES = {
  open: "ignis-statusbar-connected",
  connecting: "ignis-statusbar-connecting",
  closed: "ignis-statusbar-disconnected",
};

function initStatusBar(plugin) {
  const ws = window.__ignis.ws;

  const item = plugin.addStatusBarItem();
  item.addClass("ignis-statusbar-item");

  const dot = item.createEl("span", {
    cls: "ignis-statusbar-dot",
  });

  item.setAttribute("data-tooltip-position", "top");

  function render(state) {
    dot.className = `ignis-statusbar-dot ${STATUS_DOT_CLASSES[state] || STATUS_DOT_CLASSES.closed}`;
    item.setAttribute("aria-label", STATUS_LABELS[state] || STATUS_LABELS.closed);
  }

  render(ws.isOpen() ? "open" : "closed");

  return ws.onStateChange(render);
}

export { initStatusBar };
