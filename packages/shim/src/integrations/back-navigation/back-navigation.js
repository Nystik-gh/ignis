// Captures browser back presses and maps them to Obsidian back actions.

import { getBackAction } from "./back-action.js";

const VIRTUAL_ENTRY_STATE = { ignisVirtualEntry: true };

export function installBackNavigation() {
  const browserHistory = getBrowserHistory();
  let usingVirtualHistory = isVirtualEntry(browserHistory.state);

  window.addEventListener("keydown", startVirtualHistory, true);
  window.addEventListener("pointerup", startVirtualHistory, true);
  window.addEventListener("popstate", onPopState);

  function startVirtualHistory(event) {
    if (!isLayoutReady() || usingVirtualHistory || movesBrowserHistory(event)) {
      return;
    }

    // Don't use virtual history with synthetic events.
    if (!isTrustedActivation(event)) {
      return;
    }

    browserHistory.pushState(VIRTUAL_ENTRY_STATE, "", location.href);
    usingVirtualHistory = true;
  }

  function onPopState() {
    const leftVirtualEntry =
      usingVirtualHistory && !isVirtualEntry(browserHistory.state);
    usingVirtualHistory = isVirtualEntry(browserHistory.state);

    if (!leftVirtualEntry || !isLayoutReady()) {
      return;
    }

    const backAction = getBackAction(window.app);

    if (backAction) {
      browserHistory.forward();
      backAction();
      return;
    }

    keepVirtualEntryUrl();
  }

  function keepVirtualEntryUrl() {
    const navigation = window.navigation;
    const virtualEntryUrl =
      navigation?.entries()[navigation.currentEntry.index + 1]?.url;

    if (virtualEntryUrl && virtualEntryUrl !== location.href) {
      browserHistory.replaceState(browserHistory.state, "", virtualEntryUrl);
    }
  }
}

function getBrowserHistory() {
  // Obsidian replaces some history methods, use original to hook into the correct history.
  const { pushState, replaceState, forward } = History.prototype;
  const readState = Object.getOwnPropertyDescriptor(
    History.prototype,
    "state",
  ).get;

  return {
    get state() {
      return readState.call(history);
    },
    pushState: (...args) => pushState.apply(history, args),
    replaceState: (...args) => replaceState.apply(history, args),
    forward: () => forward.call(history),
  };
}

function isLayoutReady() {
  return window.app?.workspace?.layoutReady === true;
}

function isVirtualEntry(state) {
  return state?.ignisVirtualEntry === true;
}

function movesBrowserHistory(event) {
  if (event.type === "pointerup") {
    return event.button === 3 || event.button === 4;
  }

  if (event.key === "BrowserBack" || event.key === "BrowserForward") {
    return true;
  }

  const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const isBracket = event.key === "[" || event.key === "]";

  return (event.altKey && isArrow) || (event.metaKey && (isArrow || isBracket));
}

function isTrustedActivation(event) {
  if (!event.isTrusted) {
    return false;
  }

  const activation = navigator.userActivation;

  return !activation || activation.isActive;
}
