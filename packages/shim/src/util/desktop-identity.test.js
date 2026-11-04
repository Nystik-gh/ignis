import { describe, it, expect, afterEach } from "vitest";
import { desktopHeaders } from "./desktop-identity.js";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DESKTOP_UA_1_14_4 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) obsidian/1.14.4 Chrome/150.0.7871.250 " +
  "Electron/43.7.5 Safari/537.36";

const DESKTOP_UA_1_15_0 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) obsidian/1.15.0 Chrome/150.0.7871.250 " +
  "Electron/43.8.4 Safari/537.36";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function headersWith({ userAgent = WINDOWS_UA, obsidianVersion } = {}) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent },
    configurable: true,
  });

  globalThis.window = { __obsidianVersion: obsidianVersion };

  return desktopHeaders();
}

describe("desktop identity headers", () => {
  afterEach(() => {
    delete globalThis.window;

    if (realNavigator) {
      Object.defineProperty(globalThis, "navigator", realNavigator);
    } else {
      delete globalThis.navigator;
    }
  });

  it("templates the desktop user-agent for a version the runtime table knows", () => {
    const headers = headersWith({ obsidianVersion: "1.14.4" });

    expect(headers["user-agent"]).toBe(DESKTOP_UA_1_14_4);
  });

  it("keeps the Obsidian version and falls back to the newest Chrome and Electron pair for a version the table does not know", () => {
    const headers = headersWith({ obsidianVersion: "99.4.1" });

    expect(headers["user-agent"]).toContain("obsidian/99.4.1");
    expect(headers["user-agent"]).toContain("Chrome/150.0.7871.250");
    expect(headers["user-agent"]).toContain("Electron/43.8.4");
  });

  it("falls back to the newest table version when the bootstrap carried no version", () => {
    const missing = headersWith({ obsidianVersion: undefined });
    const placeholder = headersWith({ obsidianVersion: "0.0.0" });

    expect(missing["user-agent"]).toBe(DESKTOP_UA_1_15_0);
    expect(placeholder["user-agent"]).toBe(DESKTOP_UA_1_15_0);
  });

  it("takes the operating system segment and the platform from the real browser", () => {
    const mac = headersWith({ userAgent: MAC_UA });
    const linux = headersWith({ userAgent: LINUX_UA });

    expect(mac["user-agent"]).toContain(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    );
    expect(mac["sec-ch-ua-platform"]).toBe('"macOS"');

    expect(linux["user-agent"]).toContain(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    );
    expect(linux["sec-ch-ua-platform"]).toBe('"Linux"');
  });

  it("falls back to the Windows segment when the browser user-agent has none", () => {
    const headers = headersWith({ userAgent: "shim-tests" });

    expect(headers["user-agent"]).toBe(DESKTOP_UA_1_15_0);
    expect(headers["sec-ch-ua-platform"]).toBe('"Windows"');
  });
});
