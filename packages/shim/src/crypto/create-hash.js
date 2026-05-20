import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { sha1, md5 } from "@noble/hashes/legacy.js";

const HASHERS = {
  SHA1: sha1,
  SHA256: sha256,
  SHA512: sha512,
  MD5: md5,
};

const SUBTLE_ALG = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

function normalizeAlgorithm(algorithm) {
  return algorithm.toUpperCase().replace(/-/g, "");
}

function encode(bytes, encoding) {
  if (!encoding) {
    return bytes;
  }

  if (encoding === "hex") {
    let hex = "";

    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }

    return hex;
  }

  if (encoding === "base64") {
    let binary = "";

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  throw new Error(`Unsupported digest encoding: ${encoding}`);
}

export function createHash(algorithm) {
  const alg = normalizeAlgorithm(algorithm);
  const hasher = HASHERS[alg];

  if (!hasher) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  let inputData = new Uint8Array(0);

  return {
    update(data) {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      const merged = new Uint8Array(inputData.length + bytes.length);

      merged.set(inputData);
      merged.set(bytes, inputData.length);
      inputData = merged;

      return this;
    },

    digest(encoding) {
      return encode(hasher(inputData), encoding);
    },

    async digestAsync(encoding) {
      const subtleAlg = SUBTLE_ALG[alg];

      if (!subtleAlg) {
        // SubtleCrypto doesn't cover MD5; fall back to the sync hasher.
        return encode(hasher(inputData), encoding);
      }

      const buf = await crypto.subtle.digest(subtleAlg, inputData);
      return encode(new Uint8Array(buf), encoding);
    },
  };
}
