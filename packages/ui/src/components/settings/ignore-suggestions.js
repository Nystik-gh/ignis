function groupSuggestions(suggestions) {
  const rows = new Map();

  for (const {
    vault,
    pluginDir,
    fileCount,
    patterns,
    covered,
  } of suggestions) {
    const key = [pluginDir, ...patterns].join("\n");
    let row = rows.get(key);

    if (!row) {
      row = { pluginDir, patterns, covered: Boolean(covered), vaults: [] };
      rows.set(key, row);
    }

    row.vaults.push({ vault, fileCount });
  }

  return [...rows.values()];
}

function describeVaults(vaults) {
  return vaults
    .map(({ vault, fileCount }, i) =>
      i === 0
        ? `${fileCount.toLocaleString()} files in ${vault}`
        : `${fileCount.toLocaleString()} in ${vault}`,
    )
    .join(", ");
}

function lastSegment(pluginDir) {
  const parts = pluginDir.split("/");

  return parts[parts.length - 1];
}

function suggestionRows(suggestions) {
  return groupSuggestions(suggestions || []).map((row) => ({
    name: lastSegment(row.pluginDir),
    desc: describeVaults(row.vaults),
    values: row.patterns,
    covered: row.covered,
  }));
}

function pendingSuggestions(suggestions, rules) {
  const lines = new Set();

  for (const rule of rules || []) {
    for (const pattern of rule.patterns) {
      lines.add(pattern);
    }
  }

  return suggestionRows(suggestions).filter(
    (row) => !row.covered && row.values.some((value) => !lines.has(value)),
  );
}

export { suggestionRows, pendingSuggestions };
