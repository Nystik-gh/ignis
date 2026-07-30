export function installBuffer() {
  if (typeof window.Buffer !== "undefined") return;

  window.Buffer = {
    from: function (data, encoding) {
      if (typeof data === "string") {
        return new TextEncoder().encode(data);
      }

      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }

      return new Uint8Array(data);
    },
    alloc: function (size, fill, encoding) {
      const buf = new Uint8Array(size);

      if (fill !== undefined) {
        buf.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill);
      }

      return buf;
    },
    allocUnsafe: function (size) {
      return new Uint8Array(size);
    },
    concat: function (arrays) {
      const total = arrays.reduce((sum, a) => sum + a.length, 0);
      const result = new Uint8Array(total);
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
      return new TextEncoder().encode(str).length;
    },
    isEncoding: function (encoding) {
      return [
        "utf8",
        "utf-8",
        "ascii",
        "binary",
        "base64",
        "hex",
        "latin1",
      ].includes((encoding || "").toLowerCase());
    },
  };
}
