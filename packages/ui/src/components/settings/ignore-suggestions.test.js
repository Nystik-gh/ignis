import { describe, it, expect } from "vitest";
import { suggestionRows, pendingSuggestions } from "./ignore-suggestions.js";

describe("suggestionRows", () => {
  it("names a row by the plugin folder, the last path segment", () => {
    const rows = suggestionRows([
      {
        vault: "My Vault",
        pluginDir: ".obsidian/plugins/icons",
        fileCount: 800,
        patterns: [".obsidian/plugins/icons/icons"],
      },
    ]);

    expect(rows).toEqual([
      {
        name: "icons",
        desc: "800 files in My Vault",
        values: [".obsidian/plugins/icons/icons"],
        covered: false,
      },
    ]);
  });

  it("groups vaults sharing a plugin into one row", () => {
    const suggestion = {
      pluginDir: ".obsidian/plugins/icons",
      patterns: [".obsidian/plugins/icons/icons"],
    };

    const rows = suggestionRows([
      { ...suggestion, vault: "My Vault", fileCount: 800 },
      { ...suggestion, vault: "Work", fileCount: 620 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].desc).toBe("800 files in My Vault, 620 in Work");
  });

  it("keeps plugins whose patterns differ apart", () => {
    const rows = suggestionRows([
      {
        vault: "My Vault",
        pluginDir: ".obsidian/plugins/icons",
        fileCount: 800,
        patterns: [".obsidian/plugins/icons/icons"],
      },
      {
        vault: "Work",
        pluginDir: ".obsidian/plugins/icons",
        fileCount: 620,
        patterns: [".obsidian/plugins/icons/packs"],
      },
    ]);

    expect(rows.map((row) => row.values)).toEqual([
      [".obsidian/plugins/icons/icons"],
      [".obsidian/plugins/icons/packs"],
    ]);
  });

  it("returns no rows for a missing list", () => {
    expect(suggestionRows(undefined)).toEqual([]);
  });
});

describe("pendingSuggestions", () => {
  const suggestions = [
    {
      vault: "My Vault",
      pluginDir: ".obsidian/plugins/icons",
      fileCount: 800,
      patterns: [".obsidian/plugins/icons/a", ".obsidian/plugins/icons/b"],
    },
  ];

  it("hides a suggestion once every pattern is covered", () => {
    const rules = [
      {
        name: "icons",
        patterns: [".obsidian/plugins/icons/a", ".obsidian/plugins/icons/b"],
      },
    ];

    expect(pendingSuggestions(suggestions, rules)).toEqual([]);
  });

  it("shows a suggestion when only some of its patterns are covered", () => {
    const rules = [{ name: "icons", patterns: [".obsidian/plugins/icons/a"] }];

    const pending = pendingSuggestions(suggestions, rules);

    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("icons");
  });

  it("returns a covered suggestion again after a pattern is removed", () => {
    const covered = [
      {
        name: "icons",
        patterns: [".obsidian/plugins/icons/a", ".obsidian/plugins/icons/b"],
      },
    ];

    expect(pendingSuggestions(suggestions, covered)).toEqual([]);

    const reduced = [
      { name: "icons", patterns: [".obsidian/plugins/icons/a"] },
    ];

    expect(pendingSuggestions(suggestions, reduced)).toHaveLength(1);
  });

  it("treats an empty rule list as everything pending", () => {
    expect(pendingSuggestions(suggestions, [])).toHaveLength(1);
  });

  it("matches covering lines across separate records", () => {
    const rules = [
      { name: "one", patterns: [".obsidian/plugins/icons/a"] },
      { name: "two", patterns: [".obsidian/plugins/icons/b"] },
    ];

    expect(pendingSuggestions(suggestions, rules)).toEqual([]);
  });
});

describe("pendingSuggestions with a server-covered suggestion", () => {
  it("hides a covered suggestion even when its lines are absent from the rules", () => {
    const covered = [
      {
        vault: "My Vault",
        pluginDir: ".obsidian/plugins/topology",
        fileCount: 900,
        patterns: [".obsidian/plugins/topology/node_modules"],
        covered: true,
      },
    ];

    expect(pendingSuggestions(covered, [])).toEqual([]);
  });
});
