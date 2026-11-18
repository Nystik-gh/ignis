// Avoid resolving Node's built-in buffer module.
import { Buffer } from "buffer/"; // Adding trailing slash resolves to the buffer npm package.

export function installBuffer() {
  if (typeof window.Buffer !== "undefined") {
    return;
  }

  window.Buffer = Buffer;
}
