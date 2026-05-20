export const screenShim = {
  getPrimaryDisplay() {
    return {
      workAreaSize: {
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      },
      size: { width: window.screen.width, height: window.screen.height },
      scaleFactor: window.devicePixelRatio || 1,
      bounds: {
        x: 0,
        y: 0,
        width: window.screen.width,
        height: window.screen.height,
      },
      workArea: {
        x: 0,
        y: 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      },
    };
  },

  getAllDisplays() {
    return [screenShim.getPrimaryDisplay()];
  },

  getDisplayNearestPoint(point) {
    return screenShim.getPrimaryDisplay();
  },

  getCursorScreenPoint() {
    return { x: 0, y: 0 };
  },

  on() {},
  once() {},
  removeListener() {},
};
