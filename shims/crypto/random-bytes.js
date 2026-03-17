export function randomBytes(size) {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);

  buf.toString = function (encoding) {
    if (encoding === "hex") {
      return Array.from(this)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    if (encoding === "base64") {
      return btoa(String.fromCharCode(...this));
    }

    return new TextDecoder().decode(this);
  };

  return buf;
}
