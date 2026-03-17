const currentWindowState = {
  title: "Obsidian",
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
  isAlwaysOnTop: false,
  bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  focusTime: Date.now(),
};

const currentWindow = {
  isMaximized: () => currentWindowState.isMaximized,
  isMinimized: () => currentWindowState.isMinimized,
  isFullScreen: () => !!document.fullscreenElement,
  isAlwaysOnTop: () => currentWindowState.isAlwaysOnTop,
  isFocused: () => document.hasFocus(),
  isVisible: () => true,
  isDestroyed: () => false,

  minimize() {
    console.log("[shim:window] minimize (stub)");
  },

  maximize() {
    currentWindowState.isMaximized = true;
  },

  unmaximize() {
    currentWindowState.isMaximized = false;
  },

  restore() {
    currentWindowState.isMinimized = false;
  },

  close() {
    console.log("[shim:window] close (stub)");
  },

  focus() {
    window.focus();
  },

  show() {},
  hide() {},

  setTitle(title) {
    currentWindowState.title = title;
    document.title = title;
  },

  getTitle() {
    return currentWindowState.title;
  },

  setAlwaysOnTop(flag) {
    currentWindowState.isAlwaysOnTop = flag;
  },

  setFullScreen(flag) {
    if (flag) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  },

  getBounds() {
    return {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  },

  setBounds(bounds) {
    console.log("[shim:window] setBounds (stub):", bounds);
  },

  setSize(width, height) {},
  setPosition(x, y) {},
  center() {},

  setTrafficLightPosition() {},
  setWindowButtonPosition() {},

  get webContents() {
    return webContentsShim._current();
  },

  get menuBarVisible() {
    return false;
  },
  set menuBarVisible(v) {},

  get loaded() {
    return true;
  },
  set loaded(v) {},

  get focusTime() {
    return currentWindowState.focusTime;
  },
  set focusTime(v) {
    currentWindowState.focusTime = v;
  },

  on(event, handler) {
    if (event === "focus") {
      window.addEventListener("focus", handler);
    } else if (event === "blur") {
      window.addEventListener("blur", handler);
    } else if (event === "resize") {
      window.addEventListener("resize", handler);
    }

    return currentWindow;
  },

  once(event, handler) {
    if (event === "focus") {
      window.addEventListener("focus", handler, { once: true });
    }
    return currentWindow;
  },

  removeListener() {
    return currentWindow;
  },
  removeAllListeners() {
    return currentWindow;
  },
};

const currentWebContents = {
  id: 1,
  _zoomLevel: 0,

  get zoomLevel() {
    return this._zoomLevel;
  },
  set zoomLevel(v) {
    this._zoomLevel = v;
  },

  executeJavaScript(code) {
    try {
      return Promise.resolve(eval(code));
    } catch (e) {
      return Promise.reject(e);
    }
  },

  getZoomFactor() {
    return Math.pow(1.2, this._zoomLevel);
  },
  getZoomLevel() {
    return this._zoomLevel;
  },
  setZoomLevel(v) {
    this._zoomLevel = v;
  },

  isDevToolsOpened() {
    return false;
  },
  openDevTools() {},

  setWindowOpenHandler(handler) {
    this._windowOpenHandler = handler;
  },

  printToPDF(options) {
    return new Promise((resolve) => {
      window.print();
      resolve(Buffer.from([]));
    });
  },

  capturePage(rect) {
    // TODO: could use html2canvas
    console.log("[shim:webContents] capturePage (stub)");
    return Promise.resolve({
      toPNG: () => new Uint8Array(0),
      toJPEG: () => new Uint8Array(0),
    });
  },

  undo() {},
  redo() {},
  cut() {
    document.execCommand("cut");
  },
  copy() {
    document.execCommand("copy");
  },
  paste() {
    document.execCommand("paste");
  },
  pasteAndMatchStyle() {
    document.execCommand("paste");
  },
  replaceMisspelling(word) {},

  session: {
    availableSpellCheckerLanguages: [],
    setSpellCheckerLanguages(langs) {},
    addWordToSpellCheckerDictionary(word) {},
  },

  setSpellCheckerLanguages(langs) {},

  on(event, handler) {
    return currentWebContents;
  },
  once(event, handler) {
    return currentWebContents;
  },
  removeListener() {
    return currentWebContents;
  },

  get isSecured() {
    return true;
  },
  set isSecured(v) {},
};

// Popup tracking for PDF export etc.
let _popupWindow = null;
let _popupWebContents = null;

export function registerPopupWindow() {
  _popupWebContents = {
    id: 2,
    _zoomLevel: 0,
    getZoomFactor() {
      return 1;
    },
    getZoomLevel() {
      return 0;
    },
    setZoomLevel() {},
    printToPDF(options) {
      return Promise.resolve(Buffer.from([]));
    },
    executeJavaScript(code) {
      try {
        return Promise.resolve(eval(code));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    on() {
      return _popupWebContents;
    },
    once() {
      return _popupWebContents;
    },
    removeListener() {
      return _popupWebContents;
    },
    isDestroyed() {
      return false;
    },
    isFocused() {
      return false;
    },
  };
  _popupWindow = {
    id: 2,
    webContents: _popupWebContents,
    isDestroyed() {
      return false;
    },
    isFocused() {
      return false;
    },
    isVisible() {
      return false;
    },
    close() {
      _popupWindow = null;
      _popupWebContents = null;
    },
    destroy() {
      _popupWindow = null;
      _popupWebContents = null;
    },
    on() {
      return _popupWindow;
    },
    once() {
      return _popupWindow;
    },
    removeListener() {
      return _popupWindow;
    },
  };
  return _popupWindow;
}

export function unregisterPopupWindow() {
  _popupWindow = null;
  _popupWebContents = null;
}

export const windowShim = {
  _current: () => currentWindow,

  getFocusedWindow() {
    return currentWindow;
  },

  getAllWindows() {
    const wins = [currentWindow];
    if (_popupWindow) {
      wins.push(_popupWindow);
    }

    return wins;
  },

  fromId(id) {
    if (id === currentWindow.id) {
      return currentWindow;
    }

    if (_popupWindow && id === _popupWindow.id) {
      return _popupWindow;
    }

    return null;
  },

  fromWebContents(wc) {
    if (wc === currentWebContents) {
      return currentWindow;
    }

    if (_popupWebContents && wc === _popupWebContents) {
      return _popupWindow;
    }

    return null;
  },
};

export const webContentsShim = {
  _current: () => currentWebContents,
  fromId(id) {
    if (id === currentWebContents.id) {
      return currentWebContents;
    }

    if (_popupWebContents && id === _popupWebContents.id) {
      return _popupWebContents;
    }

    return null;
  },
  getAllWebContents() {
    const wcs = [currentWebContents];
    if (_popupWebContents) {
      wcs.push(_popupWebContents);
    }

    return wcs;
  },
};
