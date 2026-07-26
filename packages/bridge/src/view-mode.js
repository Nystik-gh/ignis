// Shared helpers for switching a MarkdownView between editing and reading mode.

// Returns a restore fn (null when there is nothing to switch); restore never fights a manual mode change.
export function enterReadingMode(view) {
  if (
    !view ||
    typeof view.getMode !== "function" ||
    typeof view.setMode !== "function" ||
    !view.modes ||
    !view.modes.preview
  ) {
    return null;
  }

  if (view.getMode() === "preview") {
    return null;
  }

  view.setMode(view.modes.preview);

  return () => {
    if (view.getMode() === "preview" && view.modes.source) {
      view.setMode(view.modes.source);
    }
  };
}
