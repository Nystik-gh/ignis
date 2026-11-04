import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installThemeColor,
  backgroundColorAtTop,
  isOpaque,
} from "./theme-color.js";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

let meta;
let stack;
let frames;
let body;
let statusBarColor;

beforeEach(() => {
  meta = { content: "#202020" };
  stack = [];
  frames = [];
  statusBarColor = TRANSPARENT;
  body = fakeElement(TRANSPARENT, fakeElement(TRANSPARENT));
  body.appendChild = vi.fn();

  globalThis.document = {
    body,
    elementsFromPoint: vi.fn(() => stack),
    querySelector: (selector) =>
      selector === 'meta[name="theme-color"]' ? meta : null,
    createElement: () => ({ style: {}, remove: vi.fn() }),
  };
  globalThis.window = {
    __ignis: { obsidian: { Platform: { isMobile: false } } },
    innerWidth: 400,
    getComputedStyle: (element) => ({
      backgroundColor:
        element.style?.backgroundColor === "var(--system-status-background)"
          ? statusBarColor
          : element.backgroundColor,
    }),
    requestAnimationFrame: (callback) => {
      frames.push(callback);
    },
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

function fakeElement(backgroundColor, parentElement = null, className = "") {
  const element = {
    backgroundColor,
    parentElement,
    className,
    contains: (other) => ancestorsOf(other).includes(element),
    closest: (selector) =>
      ancestorsOf(element).find((node) => `.${node.className}` === selector),
  };

  return element;
}

function ancestorsOf(element) {
  const ancestors = [];

  for (let node = element; node; node = node.parentElement) {
    ancestors.push(node);
  }

  return ancestors;
}

function fakeApp(workspaceEl) {
  const handlers = {};

  return {
    workspace: {
      containerEl: workspaceEl,
      onLayoutReady: (callback) => callback(),
      on: (name, handler) => {
        handlers[name] = handler;
      },
    },
    trigger: (name) => handlers[name](),
  };
}

function runFrames() {
  for (const callback of frames.splice(0)) {
    callback();
  }
}

describe("backgroundColorAtTop", () => {
  it("reads the workspace beneath an overlay", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    const header = fakeElement(TRANSPARENT, workspace);
    const modal = fakeElement("rgb(50, 50, 50)", body);
    stack = [modal, ...ancestorsOf(header)];

    expect(backgroundColorAtTop(workspace)).toBe("rgb(30, 30, 30)");
    expect(document.elementsFromPoint).toHaveBeenCalledWith(200, 0);
  });

  it("skips a semi-transparent ancestor for the opaque one above it", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    const header = fakeElement("rgba(80, 80, 80, 0.5)", workspace);
    const title = fakeElement(TRANSPARENT, header);
    stack = ancestorsOf(title);

    expect(backgroundColorAtTop(workspace)).toBe("rgb(30, 30, 30)");
  });

  it("skips elements inside a drawer", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    const drawer = fakeElement(TRANSPARENT, workspace, "workspace-drawer");
    const drawerItem = fakeElement("rgb(60, 60, 60)", drawer);
    const note = fakeElement("rgb(40, 40, 40)", workspace);
    stack = [drawerItem, drawer, ...ancestorsOf(note)];

    expect(backgroundColorAtTop(workspace)).toBe("rgb(40, 40, 40)");
  });

  it("accepts an ancestor of the workspace", () => {
    const appContainer = fakeElement("rgb(25, 25, 25)", body);
    const workspace = fakeElement(TRANSPARENT, appContainer);
    const modal = fakeElement("rgb(50, 50, 50)", body);
    stack = [modal, ...ancestorsOf(appContainer)];

    expect(backgroundColorAtTop(workspace)).toBe("rgb(25, 25, 25)");
  });

  it("reads the topmost element without a workspace element", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    const modal = fakeElement("rgb(50, 50, 50)", body);
    stack = [modal, ...ancestorsOf(workspace)];

    expect(backgroundColorAtTop(undefined)).toBe("rgb(50, 50, 50)");
  });

  it("falls back to the body when nothing is at the top", () => {
    const workspace = fakeElement(TRANSPARENT, body);
    body.backgroundColor = "rgb(20, 20, 20)";

    expect(backgroundColorAtTop(workspace)).toBe("rgb(20, 20, 20)");
  });

  it("is null when nothing is opaque", () => {
    const workspace = fakeElement(TRANSPARENT, body);
    stack = ancestorsOf(workspace);

    expect(backgroundColorAtTop(workspace)).toBeNull();
  });
});

describe("installThemeColor", () => {
  it("sets the meta on layout ready", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    stack = ancestorsOf(workspace);
    installThemeColor(fakeApp(workspace));

    expect(meta.content).toBe("rgb(30, 30, 30)");
  });

  it("uses the theme's status bar color in the mobile UI", () => {
    window.__ignis.obsidian.Platform.isMobile = true;
    statusBarColor = "rgb(10, 20, 30)";
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    stack = ancestorsOf(workspace);
    installThemeColor(fakeApp(workspace));

    expect(meta.content).toBe("rgb(10, 20, 30)");
  });

  it("samples the top in the mobile UI when the theme sets no status bar color", () => {
    window.__ignis.obsidian.Platform.isMobile = true;
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    stack = ancestorsOf(workspace);
    installThemeColor(fakeApp(workspace));

    expect(meta.content).toBe("rgb(30, 30, 30)");
  });

  it("ignores the theme's status bar color on desktop", () => {
    statusBarColor = "rgb(10, 20, 30)";
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    stack = ancestorsOf(workspace);
    installThemeColor(fakeApp(workspace));

    expect(meta.content).toBe("rgb(30, 30, 30)");
  });

  it("updates the meta in the frame after a css-change", () => {
    const workspace = fakeElement("rgb(30, 30, 30)", body);
    const app = fakeApp(workspace);
    stack = ancestorsOf(workspace);
    installThemeColor(app);

    workspace.backgroundColor = "rgb(250, 250, 250)";
    app.trigger("css-change");

    expect(meta.content).toBe("rgb(30, 30, 30)");

    runFrames();

    expect(meta.content).toBe("rgb(250, 250, 250)");
  });

  it("leaves the meta alone when nothing is opaque", () => {
    const workspace = fakeElement(TRANSPARENT, body);
    stack = ancestorsOf(workspace);
    installThemeColor(fakeApp(workspace));

    expect(meta.content).toBe("#202020");
  });

  it("does nothing without a theme-color meta", () => {
    meta = null;
    installThemeColor(fakeApp(fakeElement(TRANSPARENT, body)));

    expect(document.elementsFromPoint).not.toHaveBeenCalled();
  });
});

describe("isOpaque", () => {
  it("accepts colors without an alpha or with a full one", () => {
    expect(isOpaque("rgb(0, 0, 0)")).toBe(true);
    expect(isOpaque("rgba(0, 0, 0, 1)")).toBe(true);
    expect(isOpaque("rgb(0 0 0 / 1)")).toBe(true);
    expect(isOpaque("rgb(0 0 0 / 100%)")).toBe(true);
    expect(isOpaque("oklch(0.5 0.1 200)")).toBe(true);
    expect(isOpaque("color(srgb 0.1 0.2 0.3)")).toBe(true);
  });

  it("rejects the transparent keyword and zero alpha", () => {
    expect(isOpaque("transparent")).toBe(false);
    expect(isOpaque("rgba(0, 0, 0, 0)")).toBe(false);
    expect(isOpaque("rgb(0 0 0 / 0)")).toBe(false);
  });

  it("rejects partial alpha in legacy forms", () => {
    expect(isOpaque("rgba(0, 0, 0, 0.5)")).toBe(false);
    expect(isOpaque("hsla(0, 0%, 0%, 0.5)")).toBe(false);
  });

  it("rejects partial alpha in space-separated forms", () => {
    expect(isOpaque("rgb(0 0 0 / 0.5)")).toBe(false);
    expect(isOpaque("rgb(0 0 0 / 50%)")).toBe(false);
    expect(isOpaque("oklch(0.5 0.1 200 / 50%)")).toBe(false);
    expect(isOpaque("color(srgb 0.1 0.2 0.3 / 0.5)")).toBe(false);
  });
});
