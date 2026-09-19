import { describe, it, expect, vi, afterEach } from "vitest";

// web-frame.js assigns window.__shimWebFrame at module top level and writes
// the computed zoom scale to document.body.style.zoom.
const fakeWindow = {};
vi.stubGlobal("window", fakeWindow);
vi.stubGlobal("document", { body: { style: {} } });

const { webFrame } = await import("./web-frame.js");

describe("webFrame zoom", () => {
  afterEach(() => {
    fakeWindow.__shimWebFrame.setZoomLevel(0);
  });

  it("exposes the shared reference on window for BrowserWindow.setFrameZoomLevel", () => {
    expect(fakeWindow.__shimWebFrame).toBe(webFrame);
  });

  it("setZoomLevel stores the level and scales the body by 1.2^level", () => {
    webFrame.setZoomLevel(1);
    expect(webFrame.getZoomLevel()).toBe(1);
    expect(webFrame.getZoomFactor()).toBeCloseTo(1.2);
  });

  it("getZoomFactor reflects the inverse of setZoomFactor", () => {
    webFrame.setZoomFactor(1.44);
    expect(webFrame.getZoomFactor()).toBeCloseTo(1.44);
    expect(webFrame.getZoomLevel()).toBeCloseTo(2);
  });

  it("reset to level 0 gives a scale of 1", () => {
    webFrame.setZoomLevel(0);
    expect(webFrame.getZoomFactor()).toBe(1);
  });
});
