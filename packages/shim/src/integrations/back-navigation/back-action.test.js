import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBackAction } from "./back-action.js";

let ignisOverlays;
let presentSelectors;

class FakeKeyboardEvent {
  constructor(type, init) {
    this.type = type;
    this.key = init.key;
    this.bubbles = init.bubbles;
  }
}

beforeEach(() => {
  ignisOverlays = [];
  presentSelectors = new Set();

  globalThis.KeyboardEvent = FakeKeyboardEvent;
  globalThis.history = Object.create({ back: vi.fn() });
  globalThis.document = {
    body: fakeElement(),
    activeElement: null,
    querySelectorAll: (selector) =>
      selector === ".modal-overlay" ? ignisOverlays : [],
    querySelector: (selectors) =>
      selectors.split(", ").some((s) => presentSelectors.has(s))
        ? fakeElement()
        : null,
  };
  globalThis.window = {
    __ignis: { obsidian: { Platform: { isMobile: false } } },
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.history;
  delete globalThis.KeyboardEvent;
});

function setObsidianHistoryBack() {
  globalThis.history = { back: vi.fn() };
}

function fakeElement() {
  return { dispatchEvent: vi.fn() };
}

function fakeSplit(collapsed, isPinned = false) {
  return { collapsed, isPinned, collapse: vi.fn() };
}

function fakeApp({ backHistory = [], leftSplit, rightSplit } = {}) {
  const recentLeaf = fakeLeaf(backHistory);

  return {
    workspace: {
      activeLeaf: recentLeaf,
      getMostRecentLeaf: () => recentLeaf,
      leftSplit,
      rightSplit,
    },
  };
}

function fakeLeaf(backHistory) {
  return { history: { backHistory, back: vi.fn() } };
}

function setMobile(isMobile) {
  window.__ignis.obsidian.Platform.isMobile = isMobile;
}

function expectEscape(element) {
  expect(element.dispatchEvent).toHaveBeenCalledWith(
    expect.objectContaining({ type: "keydown", key: "Escape", bubbles: true }),
  );
}

function dispatchedTypes(element) {
  return element.dispatchEvent.mock.calls.map(([event]) => event.type);
}

describe("getBackAction", () => {
  it("sends ignis-back to the last Ignis dialog and leaves an Obsidian modal under it", () => {
    const first = fakeElement();
    const last = fakeElement();
    ignisOverlays = [first, last];
    setObsidianHistoryBack();
    presentSelectors.add(".modal-container");
    document.activeElement = fakeElement();

    getBackAction(fakeApp())();
    expect(dispatchedTypes(last)).toEqual(["ignis-back"]);
    expect(first.dispatchEvent).not.toHaveBeenCalled();
    expect(document.activeElement.dispatchEvent).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
  });

  it("goes back through Obsidian's history.back for each of its back layers", () => {
    for (const layer of [
      ".modal-container",
      ".menu",
      ".suggestion-container",
      ".lightbox",
      ".mobile-tab-switcher",
    ]) {
      setObsidianHistoryBack();
      presentSelectors = new Set([layer]);
      document.activeElement = fakeElement();
      const app = fakeApp({ backHistory: [{}] });

      getBackAction(app)();
      expect(history.back).toHaveBeenCalledTimes(1);
      expect(document.activeElement.dispatchEvent).not.toHaveBeenCalled();
      expect(
        app.workspace.getMostRecentLeaf().history.back,
      ).not.toHaveBeenCalled();
    }
  });

  it("closes an Obsidian layer before a drawer", () => {
    const leftSplit = fakeSplit(false);
    setObsidianHistoryBack();
    presentSelectors.add(".modal-container");
    setMobile(true);

    getBackAction(fakeApp({ leftSplit }))();
    expect(history.back).toHaveBeenCalled();
    expect(leftSplit.collapse).not.toHaveBeenCalled();
  });

  it("presses Escape when history.back is the browser's", () => {
    presentSelectors.add(".menu");

    getBackAction(fakeApp())();
    expectEscape(document.body);
    expect(history.back).not.toHaveBeenCalled();
  });

  it("collapses an open drawer before going back", () => {
    const leftSplit = fakeSplit(true);
    const rightSplit = fakeSplit(false);
    const app = fakeApp({ backHistory: [{}], leftSplit, rightSplit });
    setMobile(true);

    getBackAction(app)();
    expect(rightSplit.collapse).toHaveBeenCalled();
    expect(leftSplit.collapse).not.toHaveBeenCalled();
    expect(
      app.workspace.getMostRecentLeaf().history.back,
    ).not.toHaveBeenCalled();
  });

  it("leaves a pinned drawer open and goes back", () => {
    const leftSplit = fakeSplit(false, true);
    const app = fakeApp({ backHistory: [{}], leftSplit });
    setMobile(true);

    getBackAction(app)();
    expect(leftSplit.collapse).not.toHaveBeenCalled();
    expect(app.workspace.getMostRecentLeaf().history.back).toHaveBeenCalled();
  });

  it("leaves sidebars open on desktop and goes back", () => {
    const leftSplit = fakeSplit(false);
    const app = fakeApp({ backHistory: [{}], leftSplit });

    getBackAction(app)();
    expect(leftSplit.collapse).not.toHaveBeenCalled();
    expect(app.workspace.getMostRecentLeaf().history.back).toHaveBeenCalled();
  });

  it("goes back in the most recent leaf while a sidebar leaf is active", () => {
    const app = fakeApp({ backHistory: [{}] });
    const recentLeaf = app.workspace.getMostRecentLeaf();
    app.workspace.activeLeaf = fakeLeaf([]);

    getBackAction(app)();
    expect(recentLeaf.history.back).toHaveBeenCalled();
    expect(app.workspace.activeLeaf.history.back).not.toHaveBeenCalled();
  });

  it("is null with nothing to close and no history", () => {
    const app = fakeApp();

    expect(getBackAction(app)).toBeNull();
  });

  it("is null when only a sidebar has history", () => {
    const app = fakeApp();
    app.workspace.activeLeaf = fakeLeaf([{}]);

    expect(getBackAction(app)).toBeNull();
  });

  it("is null when the leaf or its history fields are missing", () => {
    for (const leaf of [null, {}, { history: {} }]) {
      const app = fakeApp();
      app.workspace.getMostRecentLeaf = () => leaf;

      expect(getBackAction(app)).toBeNull();
    }
  });
});
