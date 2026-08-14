import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

const PWA_DIR = path.join(import.meta.dirname, "assets", "pwa");

describe("PWA manifest", () => {
  it("is valid JSON with installable fields", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PWA_DIR, "manifest.webmanifest"), "utf-8"),
    );

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it("references icons that exist on disk", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PWA_DIR, "manifest.webmanifest"), "utf-8"),
    );

    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(PWA_DIR, path.basename(icon.src)))).toBe(
        true,
      );
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
      expect(icon.type).toBe("image/png");
    }
  });

  it("has the sizes required for installability", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PWA_DIR, "manifest.webmanifest"), "utf-8"),
    );

    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});

describe("service worker", () => {
  it("exists and registers an install handler", () => {
    const sw = fs.readFileSync(path.join(PWA_DIR, "sw.js"), "utf-8");

    expect(sw).toContain("self.addEventListener");
    expect(sw).toContain('"install"');
  });

  it("never intercepts api or vault-files paths", () => {
    const sw = fs.readFileSync(path.join(PWA_DIR, "sw.js"), "utf-8");

    expect(sw).toContain('startsWith("/api/")');
    expect(sw).toContain('startsWith("/vault-files/")');
  });
});

describe("index.html template", () => {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "assets", "index.html"),
    "utf-8",
  );

  it("links the web app manifest", () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  });

  it("registers the service worker", () => {
    expect(html).toContain('navigator.serviceWorker.register("/sw.js")');
  });
});
