import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const {
  resolveObsidianTerms,
  extractTermsFromRenderer,
  extractTermsFromMain,
} = require("./obsidian-terms.js");

const MOCK_TERMS = "Tinker tailor soldier spy.";

const RENDERER = `
if ("${MOCK_TERMS}" !== ipcRenderer.sendSync("terms")) {
  window.close();
}
`;

const RENDERER_WITHOUT_TERMS = `
if ("1.2.3" !== ipcRenderer.sendSync("version")) {
  window.close();
}
`;

function mainWithTerms(value) {
  return `
const TERMS = "${value}";
ipcMain.on("terms", (event) => {
  event.returnValue = TERMS;
});
`;
}

function assetsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-terms-"));

  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source);
  }

  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractTermsFromRenderer", () => {
  it("finds the literal compared against sendSync('terms'), literal first", () => {
    expect(extractTermsFromRenderer(RENDERER)).toBe(MOCK_TERMS);
  });

  it("finds the literal when the call comes first", () => {
    const source = `
if (ipcRenderer.sendSync("terms") !== "${MOCK_TERMS}") {
  window.close();
}
`;

    expect(extractTermsFromRenderer(source)).toBe(MOCK_TERMS);
  });

  it("ignores comparisons on other channels", () => {
    expect(extractTermsFromRenderer(RENDERER_WITHOUT_TERMS)).toBeNull();
  });

  it("resolves a compared identifier through its one string declaration", () => {
    const source = `
(function () {
  function gate() {
    if (ipcRenderer.sendSync("terms") !== TERMS) {
      window.close();
    }
  }

  var TERMS = "${MOCK_TERMS}";
})();
`;

    expect(extractTermsFromRenderer(source)).toBe(MOCK_TERMS);
  });

  it("does not resolve a compared identifier declared as a string twice", () => {
    const source = `
function gate() {
  var TERMS = "${MOCK_TERMS}";

  if (ipcRenderer.sendSync("terms") !== TERMS) {
    window.close();
  }
}

function other() {
  var TERMS = "something else";
}
`;

    expect(extractTermsFromRenderer(source)).toBeNull();
  });
});

describe("extractTermsFromMain", () => {
  it("resolves an identifier assigned to returnValue through its top-level declaration", () => {
    expect(extractTermsFromMain(mainWithTerms(MOCK_TERMS))).toBe(MOCK_TERMS);
  });

  it("returns null when the handler assigns something it cannot resolve", () => {
    const source = `
ipcMain.on("terms", (event) => {
  event.returnValue = buildTerms();
});
`;

    expect(extractTermsFromMain(source)).toBeNull();
  });

  it("returns null when there is no terms handler", () => {
    const source = `
ipcMain.on("version", (event) => {
  event.returnValue = VERSION;
});
`;

    expect(extractTermsFromMain(source)).toBeNull();
  });
});

describe("resolveObsidianTerms", () => {
  it("prefers the override", () => {
    const dir = assetsDir({ "app.js": RENDERER });

    expect(
      resolveObsidianTerms({ assetsPath: dir, override: "operator value" }),
    ).toBe("operator value");
  });

  it("uses app.js and warns when main.js disagrees", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = assetsDir({
      "app.js": RENDERER,
      "main.js": mainWithTerms("something else"),
    });

    expect(resolveObsidianTerms({ assetsPath: dir, override: "" })).toBe(
      MOCK_TERMS,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("app.js and main.js disagree"),
    );
  });

  it("falls back to main.js when app.js has no comparison", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = assetsDir({
      "app.js": RENDERER_WITHOUT_TERMS,
      "main.js": mainWithTerms(MOCK_TERMS),
    });

    expect(resolveObsidianTerms({ assetsPath: dir, override: "" })).toBe(
      MOCK_TERMS,
    );
  });

  it("is null when neither file has the handshake", () => {
    const dir = assetsDir({ "app.js": RENDERER_WITHOUT_TERMS });

    expect(resolveObsidianTerms({ assetsPath: dir, override: "" })).toBeNull();
  });

  it("is null when the assets are missing", () => {
    expect(
      resolveObsidianTerms({
        assetsPath: path.join(os.tmpdir(), "ignis-terms-missing"),
        override: "",
      }),
    ).toBeNull();
  });
});
