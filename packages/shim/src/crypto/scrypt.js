export function scrypt(password, salt, keylen, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }

  const N = options?.N || 32768;
  const r = options?.r || 8;
  const p = options?.p || 1;

  if (window.scrypt && window.scrypt.scrypt) {
    const pwBytes =
      typeof password === "string"
        ? new TextEncoder().encode(password)
        : password;
    const saltBytes =
      typeof salt === "string" ? new TextEncoder().encode(salt) : salt;

    window.scrypt
      .scrypt(pwBytes, saltBytes, N, r, p, keylen)
      .then((result) => callback(null, new Uint8Array(result)))
      .catch((err) => callback(err));
  } else {
    callback(new Error("scrypt not available"));
  }
}
