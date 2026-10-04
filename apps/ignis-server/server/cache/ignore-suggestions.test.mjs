import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  HEAVY_PLUGIN_FILES,
  suggestionsForTree,
} = require("./ignore-suggestions.js");
const { watcher } = require("@ignis/server-core");

const PLUGIN = ".obsidian/plugins/heavy";

function tree(...groups) {
  const out = { ".obsidian": { type: "directory" } };

  for (const [dir, count] of groups) {
    out[dir] = { type: "directory" };

    for (let i = 0; i < count; i++) {
      out[`${dir}/f${i}.svg`] = { type: "file", size: 1 };
    }
  }

  return out;
}

afterEach(() => {
  watcher.configure({ ignoredPaths: [".git"] });
});

describe("plugin subtrees worth an ignore-list line", () => {
  it("names the subdirectory the files sit in", () => {
    const t = tree(
      [`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES + 1],
      [`${PLUGIN}/notes`, 3],
    );

    t[`${PLUGIN}/manifest.json`] = { type: "file", size: 1 };

    expect(suggestionsForTree(t)).toEqual([
      {
        pluginDir: PLUGIN,
        fileCount: HEAVY_PLUGIN_FILES + 5,
        patterns: [`${PLUGIN}/icons`],
        covered: false,
      },
    ]);
  });

  it("takes the heaviest subdirectories until the rest fits under the threshold", () => {
    const t = tree(
      [`${PLUGIN}/small`, 250],
      [`${PLUGIN}/big`, 400],
      [`${PLUGIN}/mid`, 300],
    );

    expect(suggestionsForTree(t)[0].patterns).toEqual([
      `${PLUGIN}/big`,
      `${PLUGIN}/mid`,
    ]);
  });

  it("falls back to the plugin directory when the files sit at its root", () => {
    const t = tree([PLUGIN, HEAVY_PLUGIN_FILES + 1]);

    expect(suggestionsForTree(t)[0].patterns).toEqual([
      `${PLUGIN}/*`,
      `!${PLUGIN}/manifest.json`,
      `!${PLUGIN}/main.js`,
      `!${PLUGIN}/styles.css`,
      `!${PLUGIN}/data.json`,
    ]);
  });

  it("says nothing at the threshold and speaks one file past it", () => {
    expect(
      suggestionsForTree(tree([`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES])),
    ).toEqual([]);

    expect(
      suggestionsForTree(tree([`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES + 1])),
    ).toHaveLength(1);
  });

  it("passes over files an applied pattern already covers", () => {
    watcher.configure({ ignoredPaths: [`${PLUGIN}/icons`] });

    expect(
      suggestionsForTree(tree([`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES + 1])),
    ).toEqual([]);
  });

  it("orders the heaviest plugin first", () => {
    const other = ".obsidian/plugins/other";
    const t = {
      ...tree([`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES + 1]),
      ...tree([`${other}/packs`, HEAVY_PLUGIN_FILES + 900]),
    };

    expect(suggestionsForTree(t).map((s) => s.pluginDir)).toEqual([
      other,
      PLUGIN,
    ]);
  });

  it("leaves directories outside .obsidian/plugins alone", () => {
    expect(
      suggestionsForTree(tree(["Attachments", HEAVY_PLUGIN_FILES + 1])),
    ).toEqual([]);

    expect(
      suggestionsForTree(tree([".obsidian/themes", HEAVY_PLUGIN_FILES + 1])),
    ).toEqual([]);
  });
});

describe("suggestions a broader rule already covers", () => {
  it("marks a suggestion covered when its lines fall under an applied pattern", () => {
    watcher.configure({ ignoredPaths: ["node_modules"] });
    const heavy = `${PLUGIN}/node_modules`;

    const [suggestion] = suggestionsForTree(
      tree([heavy, HEAVY_PLUGIN_FILES + 1]),
      true,
    );

    expect(suggestion.patterns).toEqual([heavy]);
    expect(suggestion.covered).toBe(true);
  });

  it("marks a suggestion uncovered when nothing ignores its lines", () => {
    const [suggestion] = suggestionsForTree(
      tree([`${PLUGIN}/icons`, HEAVY_PLUGIN_FILES + 1]),
    );

    expect(suggestion.covered).toBe(false);
  });

  it("marks the plugin-root fallback covered when the plugin dir itself is ignored", () => {
    watcher.configure({ ignoredPaths: [PLUGIN] });

    const [suggestion] = suggestionsForTree(
      tree([PLUGIN, HEAVY_PLUGIN_FILES + 1]),
      true,
    );

    expect(suggestion.patterns[0]).toBe(`${PLUGIN}/*`);
    expect(suggestion.covered).toBe(true);
  });
});
