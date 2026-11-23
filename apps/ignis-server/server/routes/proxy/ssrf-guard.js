const dns = require("dns");
const net = require("net");
const settings = require("../../settings");

function isPrivateIp(ip) {
  const type = net.isIP(ip);

  if (type === 4) {
    const o = ip.split(".").map(Number);

    return (
      o[0] === 0 ||
      o[0] === 10 ||
      o[0] === 127 ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
    );
  }

  if (type === 6) {
    const a = ip.toLowerCase();

    if (a === "::1" || a === "::") {
      return true;
    }

    if (/^fe[89ab]/.test(a) || a.startsWith("fc") || a.startsWith("fd")) {
      return true;
    }

    const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);

    if (mapped) {
      return isPrivateIp(mapped[1]);
    }

    return false;
  }

  return false;
}

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .reduce((acc, oct) => ((acc << 8) + Number(oct)) >>> 0, 0);
}

// Parse PROXY_ALLOW_PRIVATE_HOSTS into matchers.
// Exact IPs (v4 and v6) and IPv4 CIDRs are supported; IPv6 CIDR and malformed entries are ignored.
function buildAllowList(entries) {
  const exact = new Set();
  const cidrV4 = [];

  for (const entry of entries) {
    const slash = entry.indexOf("/");

    if (slash === -1) {
      if (net.isIP(entry)) {
        exact.add(entry);
      } else {
        console.warn(
          "[proxy] ignoring invalid PROXY_ALLOW_PRIVATE_HOSTS entry:",
          entry,
        );
      }

      continue;
    }

    const base = entry.slice(0, slash);
    const prefix = Number(entry.slice(slash + 1));

    if (
      net.isIP(base) === 4 &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= 32
    ) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      cidrV4.push({ network: (ipv4ToInt(base) & mask) >>> 0, mask });
    } else {
      console.warn(
        "[proxy] ignoring unsupported PROXY_ALLOW_PRIVATE_HOSTS entry:",
        entry,
      );
    }
  }

  return { exact, cidrV4 };
}

function allowsAddress(allow, ip) {
  if (allow.exact.has(ip)) {
    return true;
  }

  if (net.isIP(ip) === 4) {
    const value = ipv4ToInt(ip);

    for (const { network, mask } of allow.cidrV4) {
      if ((value & mask) >>> 0 === network) {
        return true;
      }
    }
  }

  return false;
}

const privateAllowList = buildAllowList(settings.get("proxyAllowPrivate"));

// A public address always passes; a private one passes only when listed it in PROXY_ALLOW_PRIVATE_HOSTS.
function addressAllowed(ip) {
  return !isPrivateIp(ip) || allowsAddress(privateAllowList, ip);
}

function httpError(status, message, { code, expose = false } = {}) {
  const e = new Error(message);
  e.statusCode = status;
  e.expose = expose;

  if (code) {
    e.code = code;
  }

  return e;
}

const BLOCK_DOCS_URL =
  "https://ignis.thiefling.com/docs/sync/#servers-on-a-private-address";

const PRIVATE_HOST_REMEDY =
  "Allow it with the PROXY_ALLOW_PRIVATE_HOSTS env var, or add the host to " +
  "direct-fetch hosts (Settings > Ignis > General > Security) if it serves " +
  `CORS headers. See ${BLOCK_DOCS_URL}`;

function blockError(status, message, block) {
  const e = httpError(status, message);
  e.block = block;
  console.warn(`[proxy] ${message}`);
  return e;
}

function privateHostError(host) {
  return blockError(
    403,
    `Ignis blocked a connection to ${host}: private addresses are blocked by default. ${PRIVATE_HOST_REMEDY}`,
    { code: "private-host", host },
  );
}

function privateResolveError(host, address) {
  return blockError(
    403,
    `Ignis blocked a connection to ${host}: it resolves to a private address (${address}). ${PRIVATE_HOST_REMEDY}`,
    { code: "private-resolve", host, address },
  );
}

function dnsError(host) {
  return blockError(
    502,
    `Ignis could not resolve ${host}. Check the hostname, or use an IP address directly.`,
    { code: "dns", host },
  );
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }

    if (!addresses.length) {
      callback(dnsError(hostname));
      return;
    }

    for (const a of addresses) {
      if (!addressAllowed(a.address)) {
        callback(privateResolveError(hostname, a.address));
        return;
      }
    }

    if (options && options.all) {
      callback(null, addresses);
      return;
    }

    callback(null, addresses[0].address, addresses[0].family);
  });
}

// Reject non-http(s) schemes and hosts that resolve to a disallowed address.
async function assertPublicUrl(urlStr) {
  let parsed;

  try {
    parsed = new URL(urlStr);
  } catch {
    throw httpError(400, "Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Only http and https URLs are allowed");
  }

  const host = parsed.hostname;

  if (net.isIP(host)) {
    if (!addressAllowed(host)) {
      throw privateHostError(host);
    }

    return;
  }

  let addrs;

  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw dnsError(host);
  }

  for (const a of addrs) {
    if (!addressAllowed(a.address)) {
      throw privateResolveError(host, a.address);
    }
  }
}

module.exports = {
  addressAllowed,
  httpError,
  privateHostError,
  safeLookup,
  assertPublicUrl,
  isPrivateIp,
  buildAllowList,
  allowsAddress,
};
