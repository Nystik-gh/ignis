import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";

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

const SUBTLE_DIGEST = {
  "SHA-1": sha1,
  "SHA-256": sha256,
  "SHA-384": sha384,
  "SHA-512": sha512,
};

export function installSubtleDigestShim() {
  // shim only on plain-http whre crypto is missing..
  if (window.crypto && window.crypto.subtle) {
    return;
  }

  const digest = (algorithm, data) => {
    const name =
      typeof algorithm === "string" ? algorithm : algorithm && algorithm.name;
    const hasher = SUBTLE_DIGEST[name];

    if (!hasher) {
      return Promise.reject(
        new Error("crypto.subtle.digest: unsupported algorithm " + name),
      );
    }

    const view =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const out = hasher(view);
    return Promise.resolve(
      out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
    );
  };

  try {
    Object.defineProperty(window.crypto, "subtle", {
      configurable: true,
      value: { digest },
    });
  } catch {}
}
