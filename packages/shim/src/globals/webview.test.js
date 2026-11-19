import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installWebview } from "./webview.js";

vi.mock("../electron/remote/window.js", () => ({
  MAIN_WEB_CONTENTS_ID: 1,
}));

class FakeIframe extends EventTarget {
  attributes = {};
  classes = new Set();
  classList = { add: (name) => this.classes.add(name) };

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  get src() {
    return this.attributes.src ?? "";
  }

  set src(url) {
    this.attributes.src = String(url);
  }
}

let calls;

function createDocument() {
  class FakeDocument {
    createElement(tagName, options) {
      calls.push({ self: this, args: [...arguments] });

      return tagName === "iframe" ? new FakeIframe() : { tagName, options };
    }
  }

  vi.stubGlobal("Document", FakeDocument);
  installWebview();

  return new FakeDocument();
}

function sandboxOf(webview) {
  return webview.attributes.sandbox.split(" ");
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("location", {
    href: "https://ignis.test/",
    origin: "https://ignis.test",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("document.createElement", () => {
  it("passes other tags through with the same this and arguments", () => {
    const doc = createDocument();
    const options = { is: "x-thing" };
    const el = doc.createElement("div", options);

    expect(el).toEqual({ tagName: "div", options });
    expect(calls).toEqual([{ self: doc, args: ["div", options] }]);
  });

  it("returns a sandboxed iframe for webview in any case", () => {
    const doc = createDocument();

    for (const tag of ["webview", "WEBVIEW"]) {
      const webview = doc.createElement(tag);

      expect(webview).toBeInstanceOf(FakeIframe);
      expect(sandboxOf(webview)).not.toContain("allow-same-origin");
      expect(webview.attributes.allow).toBe("fullscreen");
      expect(webview.classes.has("ignis-webview")).toBe(true);
    }
  });
});

describe("the webview sandbox", () => {
  it("keeps the origin of another web origin's page", () => {
    const webview = createDocument().createElement("webview");

    webview.src = "https://example.test/page";
    expect(sandboxOf(webview)).toContain("allow-same-origin");

    webview.setAttribute("src", "http://other.test/");
    expect(sandboxOf(webview)).toContain("allow-same-origin");
  });

  it("withholds it from pages on the Ignis origin and non-web URLs", () => {
    const webview = createDocument().createElement("webview");

    webview.src = "https://example.test/page";
    webview.src = "/vault-files/vault/page.html";
    expect(sandboxOf(webview)).not.toContain("allow-same-origin");

    webview.setAttribute("src", "https://ignis.test/other.html");
    expect(sandboxOf(webview)).not.toContain("allow-same-origin");

    webview.src = "data:text/plain,";
    expect(sandboxOf(webview)).not.toContain("allow-same-origin");
  });
});

describe("webview loading", () => {
  it("loadURL sets src and resolves after the load events fire", async () => {
    const webview = createDocument().createElement("webview");
    const fired = [];

    for (const name of ["dom-ready", "did-finish-load", "did-stop-loading"]) {
      webview.addEventListener(name, () => fired.push(name));
    }

    const done = webview.loadURL("https://example.test/");

    expect(webview.src).toBe("https://example.test/");
    expect(webview.isLoading()).toBe(true);

    webview.dispatchEvent(new Event("load"));

    await expect(done).resolves.toBeUndefined();
    expect(fired).toEqual(["dom-ready", "did-finish-load", "did-stop-loading"]);
    expect(webview.isLoading()).toBe(false);
  });
});
