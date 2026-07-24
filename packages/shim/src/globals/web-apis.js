import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { reportInsecureApi } from "../util/insecure-api.js";
import { execCommandCopy } from "../util/clipboard.js";

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

// build a v4 UUID from getRandomValues. fix for insecure origins.
export function installRandomUUIDShim() {
  if (typeof window.crypto.randomUUID === "function") {
    return;
  }

  if (typeof window.crypto.getRandomValues !== "function") {
    return;
  }

  const randomUUID = () => {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex = "";

    for (let i = 0; i < 16; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }

    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  };

  try {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      writable: true,
      value: randomUUID,
    });
  } catch {}
}

// Obsidian replaces these at boot with wrappers over electron.clipboard.
export function installClipboardShim() {
  if (navigator.clipboard) {
    return;
  }

  const writeText = (text) => {
    try {
      return execCommandCopy(text)
        ? Promise.resolve()
        : Promise.reject(new Error("clipboard write failed"));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const readText = () => {
    reportInsecureApi("navigator.clipboard.readText");
    return Promise.reject(
      new Error(
        "navigator.clipboard.readText is unavailable on insecure origins",
      ),
    );
  };

  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText },
    });
  } catch {}
}

// handle insecure contexts.
export function installMediaDevicesShim() {
  if (navigator.mediaDevices) {
    return;
  }

  const getUserMedia = () => {
    reportInsecureApi("navigator.mediaDevices.getUserMedia");
    return Promise.reject(
      new Error(
        "navigator.mediaDevices.getUserMedia is unavailable on insecure origins",
      ),
    );
  };

  try {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  } catch {}
}

const SUBTLE_DIGEST = {
  "SHA-1": sha1,
  "SHA-256": sha256,
  "SHA-384": sha384,
  "SHA-512": sha512,
};

// crypto methods stubbed to report and reject.
const SUBTLE_STUB_METHODS = [
  "encrypt",
  "decrypt",
  "sign",
  "verify",
  "generateKey",
  "deriveKey",
  "deriveBits",
  "importKey",
  "exportKey",
  "wrapKey",
  "unwrapKey",
];

export function installSubtleShim() {
  if (window.crypto && window.crypto.subtle) {
    return;
  }

  // shim digest since it can be safely implemented and is needed for obsidian features.
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

  const subtle = { digest };

  // stub the crypto methods we can't safely implement.
  for (const method of SUBTLE_STUB_METHODS) {
    subtle[method] = () => {
      reportInsecureApi("crypto.subtle." + method);
      return Promise.reject(
        new Error(
          "crypto.subtle." + method + " is unavailable on insecure origins",
        ),
      );
    };
  }

  try {
    Object.defineProperty(window.crypto, "subtle", {
      configurable: true,
      value: subtle,
    });
  } catch {}
}
