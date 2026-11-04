const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const PLACEHOLDER_BASE = "http://placeholder.invalid";

function parseQuery(search) {
  const query = Object.create(null);

  for (const [key, value] of new URLSearchParams(search)) {
    const existing = query[key];

    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }

  return query;
}

function authOf(url) {
  const username = decodeURIComponent(url.username);

  if (url.password) {
    return `${username}:${decodeURIComponent(url.password)}`;
  }

  return username || null;
}

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

  parse(str, parseQueryString) {
    const hashIndex = str.indexOf("#");
    const beforeHash = hashIndex === -1 ? str : str.slice(0, hashIndex);
    const isAbsolute = SCHEME.test(str);
    const url = isAbsolute ? new URL(str) : new URL(str, PLACEHOLDER_BASE);

    const search = url.search || (beforeHash.includes("?") ? "?" : null);
    const hash = url.hash || (hashIndex === -1 ? null : "#");
    let query = search === null ? null : search.slice(1);

    if (parseQueryString) {
      query = parseQuery(url.search);
    }

    const pathname = isAbsolute
      ? url.pathname
      : beforeHash.split("?")[0] || null;

    const path =
      pathname === null && search === null
        ? null
        : (pathname || "") + (search || "");

    if (!isAbsolute) {
      return {
        protocol: null,
        slashes: null,
        auth: null,
        host: null,
        port: null,
        hostname: null,
        hash,
        search,
        query,
        pathname,
        path,
        href: (path || "") + (hash || ""),
      };
    }

    return {
      protocol: url.protocol,
      slashes: url.href.startsWith(`${url.protocol}//`) ? true : null,
      auth: authOf(url),
      host: url.host,
      port: url.port || null,
      hostname: url.hostname,
      hash,
      search,
      query,
      pathname,
      path,
      href: url.href,
    };
  },
};
