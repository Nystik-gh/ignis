import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installBackNavigation } from "./back-navigation.js";
import { getBackAction } from "./back-action.js";

vi.mock("./back-action.js", () => ({ getBackAction: vi.fn() }));

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const VIRTUAL_ENTRY = { ignisVirtualEntry: true };
const PAGE_URL = "https://ignis.test/?vault=v1";

let listeners;
let browser;
let backAction;

beforeEach(() => {
  listeners = {};
  backAction = vi.fn();
  getBackAction.mockReset();
  getBackAction.mockReturnValue(null);

  setNavigator({ userActivation: { isActive: true } });
  setBrowserHistory([null]);
  globalThis.window = {
    app: { workspace: { layoutReady: true } },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.history;
  delete globalThis.History;
  delete globalThis.location;

  if (realNavigator) {
    Object.defineProperty(globalThis, "navigator", realNavigator);
  } else {
    delete globalThis.navigator;
  }
});

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
  });
}

function setBrowserHistory(states) {
  browser = {
    entries: states.map((state) => ({ state, url: PAGE_URL })),
    index: states.length - 1,
    queuedForwards: 0,
  };

  globalThis.location = {
    get href() {
      return browser.entries[browser.index].url;
    },
  };
  const prototype = {
    get state() {
      return browser.entries[browser.index].state;
    },
    pushState: vi.fn((state, title, url) => {
      browser.entries.splice(browser.index + 1);
      browser.entries.push({ state: structuredClone(state), url });
      browser.index += 1;
    }),
    replaceState: vi.fn((state, title, url) => {
      browser.entries[browser.index] = { state: structuredClone(state), url };
    }),
    forward: vi.fn(() => {
      browser.queuedForwards += 1;
    }),
  };

  globalThis.History = { prototype };
  globalThis.history = Object.create(prototype);
}

function replaceWindowHistoryMethods() {
  for (const name of ["back", "forward", "go", "pushState", "replaceState"]) {
    history[name] = vi.fn();
  }

  Object.defineProperty(history, "state", { get: () => "replaced" });
}

function enableNavigationApi() {
  window.navigation = {
    get currentEntry() {
      return { index: browser.index };
    },
    entries: () => browser.entries.map(({ url }) => ({ url })),
  };
}

function states() {
  return browser.entries.map(({ state }) => state);
}

function traverse(delta) {
  const target = browser.index + delta;

  if (target < 0 || target >= browser.entries.length) {
    return;
  }

  browser.index = target;
  listeners.popstate({});
}

function pressBack() {
  traverse(-1);
}

function pressForward() {
  traverse(1);
}

function runQueuedForwards() {
  while (browser.queuedForwards > 0) {
    browser.queuedForwards -= 1;
    traverse(1);
  }
}

function withBackAction() {
  getBackAction.mockReturnValue(backAction);
}

function tap(event = { type: "pointerup", button: 0, isTrusted: true }) {
  listeners.pointerup(event);
}

describe("starting virtual history", () => {
  it("ignores input and back presses until the layout is ready", () => {
    window.app.workspace.layoutReady = false;
    setBrowserHistory([null, VIRTUAL_ENTRY]);
    withBackAction();
    installBackNavigation();

    tap();
    pressBack();

    expect(history.pushState).not.toHaveBeenCalled();
    expect(backAction).not.toHaveBeenCalled();
  });

  it("ignores untrusted events", () => {
    installBackNavigation();

    tap({ type: "pointerup", button: 0, isTrusted: false });
    listeners.keydown({ type: "keydown", key: "a", isTrusted: false });

    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("ignores events without an active user activation", () => {
    setNavigator({ userActivation: { isActive: false } });
    installBackNavigation();

    tap();

    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("pushes the virtual entry when the browser has no userActivation", () => {
    setNavigator({});
    installBackNavigation();

    tap();

    expect(history.pushState).toHaveBeenCalledWith(VIRTUAL_ENTRY, "", PAGE_URL);
  });

  it("pushes once while using virtual history", () => {
    installBackNavigation();

    tap();
    listeners.keydown({ type: "keydown", key: "a", isTrusted: true });
    tap();

    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("ignores the browser's own back and forward inputs", () => {
    installBackNavigation();

    tap({ type: "pointerup", button: 3, isTrusted: true });
    tap({ type: "pointerup", button: 4, isTrusted: true });

    for (const key of [
      { key: "ArrowLeft", altKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "[", metaKey: true },
      { key: "]", metaKey: true },
      { key: "ArrowLeft", metaKey: true },
      { key: "BrowserBack" },
      { key: "BrowserForward" },
    ]) {
      listeners.keydown({ type: "keydown", isTrusted: true, ...key });
    }

    expect(history.pushState).not.toHaveBeenCalled();
  });
});

describe("back presses", () => {
  it("goes back and resumes virtual history", () => {
    withBackAction();
    installBackNavigation();

    tap();
    pressBack();

    expect(backAction).toHaveBeenCalled();
    expect(History.prototype.forward).toHaveBeenCalledTimes(1);

    runQueuedForwards();
    tap();

    expect(history.state).toEqual(VIRTUAL_ENTRY);
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("uses History.prototype when window.history's methods are replaced", () => {
    withBackAction();
    replaceWindowHistoryMethods();
    installBackNavigation();

    tap();
    pressBack();
    runQueuedForwards();

    expect(History.prototype.pushState).toHaveBeenCalledTimes(1);
    expect(History.prototype.forward).toHaveBeenCalledTimes(1);
    expect(backAction).toHaveBeenCalled();
    expect(states()).toEqual([null, VIRTUAL_ENTRY]);
    expect(browser.index).toBe(1);

    for (const name of ["back", "forward", "go", "pushState", "replaceState"]) {
      expect(history[name]).not.toHaveBeenCalled();
    }
  });

  it("returns to the virtual entry before going back", () => {
    withBackAction();
    installBackNavigation();

    tap();
    pressBack();

    expect(History.prototype.forward.mock.invocationCallOrder[0]).toBeLessThan(
      backAction.mock.invocationCallOrder[0],
    );
  });

  it("stops using virtual history when unhandled", () => {
    installBackNavigation();

    tap();
    pressBack();

    expect(History.prototype.forward).not.toHaveBeenCalled();
    expect(history.state).toBeNull();

    tap();

    expect(history.pushState).toHaveBeenCalledTimes(2);
  });

  it("keeps the virtual entry's URL when unhandled", () => {
    enableNavigationApi();
    installBackNavigation();

    tap();
    history.replaceState(history.state, "", `${PAGE_URL}&workspace=B`);
    pressBack();

    expect(location.href).toBe(`${PAGE_URL}&workspace=B`);
    expect(history.state).toBeNull();

    tap();

    expect(history.pushState).toHaveBeenLastCalledWith(
      VIRTUAL_ENTRY,
      "",
      `${PAGE_URL}&workspace=B`,
    );
  });

  it("leaves the URL alone without the Navigation API", () => {
    installBackNavigation();

    tap();
    history.replaceState(history.state, "", `${PAGE_URL}&workspace=B`);
    pressBack();

    expect(location.href).toBe(PAGE_URL);
  });

  it("uses virtual history again after a forward press", () => {
    installBackNavigation();

    tap();
    pressBack();
    pressForward();
    tap();

    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("keeps one virtual entry when an activation comes before the resume", () => {
    withBackAction();
    installBackNavigation();

    tap();
    pressBack();
    tap();
    runQueuedForwards();

    expect(history.state).toEqual(VIRTUAL_ENTRY);
    expect(states()).toEqual([null, VIRTUAL_ENTRY]);
  });
});

describe("reloads", () => {
  it("keeps virtual history when the virtual entry is current", () => {
    setBrowserHistory([null, VIRTUAL_ENTRY]);
    withBackAction();
    installBackNavigation();

    tap();

    expect(history.pushState).not.toHaveBeenCalled();

    pressBack();

    expect(backAction).toHaveBeenCalled();
    expect(History.prototype.forward).toHaveBeenCalledTimes(1);
  });
});
