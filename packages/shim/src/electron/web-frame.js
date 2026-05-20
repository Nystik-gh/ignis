let currentZoom = 0;

export const webFrame = {
  getZoomLevel() {
    return currentZoom;
  },

  setZoomLevel(level) {
    currentZoom = level;
    // Approximate Electron's zoom behavior via CSS zoom
    // Electron zoom level 0 = 100%, each step is ~20%
    const scale = Math.pow(1.2, level);
    document.body.style.zoom = scale;
  },

  getZoomFactor() {
    return Math.pow(1.2, currentZoom);
  },

  setZoomFactor(factor) {
    currentZoom = Math.log(factor) / Math.log(1.2);
    document.body.style.zoom = factor;
  },
};
