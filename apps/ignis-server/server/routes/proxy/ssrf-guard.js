const dns = require("dns");
const net = require("net");
const settings = require("../../settings");

function ipLiteral(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");

  return net.isIP(host) ? host : null;
}

function ipv6Groups(ip) {
  let address = ip.split("%")[0].toLowerCase();
  const lastGroup = address.slice(address.lastIndexOf(":") + 1);

  if (lastGroup.includes(".")) {
    const o = lastGroup.split(".").map(Number);
    const high = ((o[0] << 8) | o[1]).toString(16);
    const low = ((o[2] << 8) | o[3]).toString(16);
    address = address.slice(0, -lastGroup.length) + high + ":" + low;
  }

  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const zeroGroups = Array(8 - headGroups.length - tailGroups.length).fill("0");

  return [...headGroups, ...zeroGroups, ...tailGroups].map((group) =>
    parseInt(group, 16),
  );
}

function embeddedIpv4(groups) {
  const isMapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isNat64 =
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0);

  if (!isMapped && !isNat64) {
    return null;
  }

  return [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ].join(".");
}

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
    const groups = ipv6Groups(ip);
    const ipv4 = embeddedIpv4(groups);

    if (ipv4) {
      return isPrivateIp(ipv4);
    }

    const isLoopbackOrUnspecified = groups.slice(0, 6).every((g) => g === 0);
    const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80;
    const isUniqueLocal = (groups[0] & 0xfe00) === 0xfc00;

    return isLoopbackOrUnspecified || isLinkLocal || isUniqueLocal;
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

  const literal = ipLiteral(parsed.hostname);

  if (literal) {
    if (!addressAllowed(literal)) {
      throw privateHostError(literal);
    }

    return;
  }

  const host = parsed.hostname;

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
  ipLiteral,
  httpError,
  privateHostError,
  safeLookup,
  assertPublicUrl,
  isPrivateIp,
  buildAllowList,
  allowsAddress,
};
