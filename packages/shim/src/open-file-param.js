// Opens the note named by the ?file= URL param once the workspace is ready.

export function installOpenFileParam(app) {
  app.workspace.onLayoutReady(() => {
    const raw = new URLSearchParams(window.location.search).get("file");

    if (!raw) {
      return;
    }

    // Strip param so a reload after navigating away does not reopen this note.
    stripFileParam();

    const hashIndex = raw.indexOf("#");
    const path = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;

    if (!path) {
      return;
    }

    const file = resolveFile(app, path);

    if (!file) {
      new window.__ignis.obsidian.Notice(`Ignis: note not found: ${path}`);
      return;
    }

    const anchor = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    app.workspace.openLinkText(file.path + anchor, "", false);
  });
}

function resolveFile(app, path) {
  const { TFile } = window.__ignis.obsidian;

  const exact = app.vault.getAbstractFileByPath(path);

  if (exact instanceof TFile) {
    return exact;
  }

  const withExtension = app.vault.getAbstractFileByPath(path + ".md");

  if (withExtension instanceof TFile) {
    return withExtension;
  }

  return app.metadataCache.getFirstLinkpathDest(path, "");
}

function stripFileParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("file");
  history.replaceState(null, "", url.toString());
}
