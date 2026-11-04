// Keeps the theme-color meta tag matched to the workspace background at the top of the window.

export function installThemeColor(app) {
  app.workspace.onLayoutReady(() => {
    updateThemeColor(app);

    app.workspace.on("css-change", () => {
      window.requestAnimationFrame(() => updateThemeColor(app));
    });
  });
}

function updateThemeColor(app) {
  const meta = document.querySelector('meta[name="theme-color"]');

  if (!meta) {
    return;
  }

  const color =
    themeStatusBarColor() ?? backgroundColorAtTop(app.workspace.containerEl);

  if (color) {
    meta.content = color;
  }
}

export function themeStatusBarColor() {
  if (!window.__ignis.obsidian?.Platform?.isMobile) {
    return null;
  }

  const probe = document.createElement("div");
  probe.style.backgroundColor = "var(--system-status-background)";
  document.body.appendChild(probe);
  const color = window.getComputedStyle(probe).backgroundColor;
  probe.remove();

  return isOpaque(color) ? color : null;
}

export function backgroundColorAtTop(workspaceEl) {
  const stack = document.elementsFromPoint(window.innerWidth / 2, 0);
  const top = workspaceEl
    ? stack.find((element) => isWorkspaceSurface(element, workspaceEl))
    : stack[0];

  for (let element = top; element; element = element.parentElement) {
    const color = window.getComputedStyle(element).backgroundColor;

    if (isOpaque(color)) {
      return color;
    }
  }

  const bodyColor = window.getComputedStyle(document.body).backgroundColor;

  return isOpaque(bodyColor) ? bodyColor : null;
}

function isWorkspaceSurface(element, workspaceEl) {
  if (element.closest(".workspace-drawer")) {
    return false;
  }

  return workspaceEl.contains(element) || element.contains(workspaceEl);
}

export function isOpaque(color) {
  if (color === "transparent") {
    return false;
  }

  const alpha = alphaComponent(color);

  if (alpha === null) {
    return true;
  }

  const value = parseFloat(alpha);

  return alpha.trim().endsWith("%") ? value === 100 : value === 1;
}

function alphaComponent(color) {
  const args = color.match(/\((.*)\)$/)?.[1];

  if (!args) {
    return null;
  }

  if (args.includes("/")) {
    return args.slice(args.lastIndexOf("/") + 1);
  }

  const commaSeparated = args.split(",");

  return commaSeparated.length === 4 ? commaSeparated[3] : null;
}
