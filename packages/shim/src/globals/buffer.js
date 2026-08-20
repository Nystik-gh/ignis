const CHUNK = 8192;

const ENCODINGS = [
  "utf8",
  "utf-8",
  "ascii",
  "binary",
  "base64",
  "hex",
  "latin1",
];

const warnedEncodings = new Set();

function normalizeEncoding(encoding) {
  const enc = (encoding || "utf-8").toLowerCase();

  if (ENCODINGS.includes(enc)) {
    return enc;
  }

  if (!warnedEncodings.has(enc)) {
    warnedEncodings.add(enc);
    console.warn(`[shim:buffer] unknown encoding "${enc}", treating as utf-8`);
  }

  return "utf-8";
}

function binaryString(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }

  return binary;
}

class BufferShim extends Uint8Array {
  toString(encoding = "utf-8") {
    const enc = normalizeEncoding(encoding);

    if (enc === "base64") {
      return btoa(binaryString(this));
    }

    if (enc === "hex") {
      let hex = "";

      for (let i = 0; i < this.length; i++) {
        hex += this[i].toString(16).padStart(2, "0");
      }

      return hex;
    }

    if (enc === "ascii" || enc === "latin1" || enc === "binary") {
      return binaryString(this);
    }

    return new TextDecoder().decode(this);
  }
}

function fromString(str, encoding) {
  const enc = normalizeEncoding(encoding);

  if (enc === "base64") {
    const binary = atob(str);
    const bytes = new BufferShim(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  if (enc === "hex") {
    const bytes = new BufferShim(Math.floor(str.length / 2));

    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
  }

  if (enc === "ascii" || enc === "latin1" || enc === "binary") {
    const bytes = new BufferShim(str.length);

    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }

    return bytes;
  }

  return new BufferShim(new TextEncoder().encode(str));
}

export function installBuffer() {
  if (typeof window.Buffer !== "undefined") return;

  window.Buffer = {
    from: function (data, encoding) {
      if (typeof data === "string") {
        return fromString(data, encoding);
      }

      return new BufferShim(data);
    },
    alloc: function (size, fill, encoding) {
      const buf = new BufferShim(size);

      if (fill !== undefined) {
        buf.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill);
      }

      return buf;
    },
    allocUnsafe: function (size) {
      return new BufferShim(size);
    },
    concat: function (arrays) {
      const total = arrays.reduce((sum, a) => sum + a.length, 0);
      const result = new BufferShim(total);
      let offset = 0;

      for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
      }

      return result;
    },
    isBuffer: function (obj) {
      return obj instanceof Uint8Array;
    },
    byteLength: function (str, encoding) {
      const enc = normalizeEncoding(encoding);

      if (enc === "base64") {
        const unpadded = str.replace(/=+$/, "");

        return Math.floor((unpadded.length * 3) / 4);
      }

      if (enc === "hex") {
        return Math.floor(str.length / 2);
      }

      if (enc === "ascii" || enc === "latin1" || enc === "binary") {
        return str.length;
      }

      return new TextEncoder().encode(str).length;
    },
    isEncoding: function (encoding) {
      return ENCODINGS.includes((encoding || "").toLowerCase());
    },
  };
}
