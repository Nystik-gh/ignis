// Obsidian points navigator.clipboard.writeText at electron.clipboard, which already points at this shim.
// To avoid recursion, use the untouched native prototype methods.
const proto = typeof Clipboard !== "undefined" ? Clipboard.prototype : null;

// Returns a native-backed clipboard facade, or null in insecure (non-localhost http) contexts.
export function getClipboard() {
  const clip =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (!proto || !clip) {
    return null;
  }

  return {
    writeText: (text) => proto.writeText.call(clip, text),
    write: (items) => proto.write.call(clip, items),
    read: () => proto.read.call(clip),
  };
}
