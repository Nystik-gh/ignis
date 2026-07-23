export function installVibrateShim() {
  if (typeof navigator.vibrate === "function") {
    return;
  }

  // Some Firefox configurations leave navigator.vibrate undefined (gated by dom.vibrator.enabled).
  // Obsidian assumes it's always callable, so provide a no-op when it's missing.
  try {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: () => true,
    });
  } catch {}
}

export function installQueryLocalFontsShim() {
  const native =
    typeof window.queryLocalFonts === "function"
      ? window.queryLocalFonts.bind(window)
      : null;

  try {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => (native ? native().catch(() => []) : Promise.resolve([])),
    });
  } catch {}
}
