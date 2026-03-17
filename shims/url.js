export const urlShim = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,

  pathToFileURL(p) {
    // Return an object with .href matching Node's url.pathToFileURL behavior
    const encoded = encodeURI(p.replace(/\\/g, "/"));
    const href = "file:///" + encoded.replace(/^\/+/, "");

    return { href, toString: () => href };
  },

  fileURLToPath(url) {
    let str = typeof url === "string" ? url : url.href || url.toString();

    if (str.startsWith("file:///")) {
      str = str.slice(8);
    } else if (str.startsWith("file://")) {
      str = str.slice(7);
    }

    return decodeURI(str);
  },
};
