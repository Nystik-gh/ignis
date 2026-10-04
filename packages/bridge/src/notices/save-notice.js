import { Notice } from "obsidian";

// Delay past the store's pending threshold so a save landing shortly after never flashes the notice.
const SHOW_AFTER_PENDING_MS = 1000;

const SAVED_HIDE_MS = 2000;

// The aggregate only notifies on clean/pending flips, so the retrying count needs polling.
const REFRESH_MS = 2000;

// One notice per saving episode.
function initSaveNotice() {
  const writes = window.__ignis.writes;

  if (!writes) {
    return () => {};
  }

  let notice = null;
  let savedNotice = null;
  let showTimer = null;
  let refreshTimer = null;
  let watchTimer = null;
  let failedAtStart = 0;

  function isConfigPath(path) {
    return /(^|\/)\.obsidian\//.test(String(path));
  }

  function pendingHasNote() {
    if (typeof writes.listPending !== "function") {
      return true;
    }

    // only show the notice if a note write is pending; config writes are silent.
    return writes.listPending().some((p) => !isConfigPath(p));
  }

  function message() {
    const { retrying } = writes.getDetail();

    return retrying > 0 ? `Saving... (${retrying} retrying)` : "Saving...";
  }

  function beginEpisode() {
    // A fresh episode replaces a still-fading "Saved" so the two never stack.
    if (savedNotice) {
      savedNotice.hide();
      savedNotice = null;
    }

    failedAtStart = writes.listFailed().length;

    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = null;
      // Timeout 0 keeps the notice up until resolved.
      notice = new Notice(message(), 0);
      refreshTimer = setInterval(
        () => notice.setMessage(message()),
        REFRESH_MS,
      );
    }, SHOW_AFTER_PENDING_MS);
  }

  function endEpisode() {
    clearTimeout(showTimer);
    showTimer = null;
    clearInterval(refreshTimer);
    refreshTimer = null;

    if (!notice) {
      return;
    }

    const n = notice;
    notice = null;

    // Clean also fires on a permanent give-up.
    if (writes.listFailed().length > failedAtStart) {
      n.hide();
      return;
    }

    n.setMessage("Saved");
    n.setAutoHide(SAVED_HIDE_MS);
    savedNotice = n;
  }

  // poll for note writes while pending.
  function watchForNote() {
    clearInterval(watchTimer);

    watchTimer = setInterval(() => {
      if (writes.getState() !== "pending") {
        clearInterval(watchTimer);
        watchTimer = null;
        return;
      }

      if (pendingHasNote()) {
        clearInterval(watchTimer);
        watchTimer = null;
        beginEpisode();
      }
    }, 1000);
  }

  const unsubState = writes.onStateChange((state) => {
    if (state === "pending") {
      if (pendingHasNote()) {
        beginEpisode();
      } else {
        watchForNote();
      }
    } else {
      clearInterval(watchTimer);
      watchTimer = null;
      endEpisode();
    }
  });

  return () => {
    unsubState();
    clearTimeout(showTimer);
    clearInterval(refreshTimer);
    clearInterval(watchTimer);

    if (notice) {
      notice.hide();
      notice = null;
    }

    if (savedNotice) {
      savedNotice.hide();
      savedNotice = null;
    }
  };
}

export { initSaveNotice };
