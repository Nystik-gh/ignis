import { describe, it, expect } from "vitest";
import { detectBrowser } from "./browser-detect.js";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const EDGE = CHROME + " Edg/124.0.0.0";
const OPERA = CHROME + " OPR/109.0.0.0";
const VIVALDI = CHROME + " Vivaldi/6.7";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("detectBrowser", () => {
  it("detects Chromium browsers, matching variants before the Chrome default (their UA also contains Chrome)", () => {
    expect(detectBrowser(CHROME)).toBe("chrome");
    expect(detectBrowser(EDGE)).toBe("edge");
    expect(detectBrowser(OPERA)).toBe("opera");
    expect(detectBrowser(VIVALDI)).toBe("vivaldi");
  });

  it("detects Firefox and Safari", () => {
    expect(detectBrowser(FIREFOX)).toBe("firefox");
    expect(detectBrowser(SAFARI)).toBe("safari");
  });

  it("defaults to Chrome for an unknown or empty user-agent", () => {
    expect(detectBrowser("")).toBe("chrome");
    expect(detectBrowser("something weird")).toBe("chrome");
  });
});
