import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  isPrivateIp,
  assertPublicUrl,
  buildAllowList,
  allowsAddress,
} = require("./ssrf-guard.js");
const { proxyRequest } = require("./relay.js");

describe("isPrivateIp", () => {
  it("flags private and link-local IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4, including range boundaries", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "172.15.255.255",
      "172.32.0.0",
      "100.63.255.255",
      "100.128.0.0",
      "169.253.0.0",
      "169.255.0.0",
      "11.0.0.1",
      "192.169.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags private and link-local IPv6", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "feaf::1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("classifies IPv4-mapped IPv6 by the embedded address", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("classifies the hex form of an embedded IPv4 address", () => {
    for (const ip of ["::ffff:7f00:2", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }

    for (const ip of ["::ffff:808:808", "64:ff9b::808:808"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags private IPv6 in any spelling", () => {
    for (const ip of [
      "0:0:0:0:0:0:0:1",
      "0:0:0:0:0:0:0:0",
      "::127.0.0.1",
      "FE80::1",
      "fe80::1%eth0",
      "fd00:0:0:0:0:0:0:1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("returns false for non-IP input", () => {
    expect(isPrivateIp("not-an-ip")).toBe(false);
    expect(isPrivateIp("")).toBe(false);
  });
});

describe("proxyRequest guard", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    await expect(
      proxyRequest({ url: "http://localhost/", method: "GET", headers: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a private IP literal (no DNS lookup runs for literals)", async () => {
    await expect(
      proxyRequest({ url: "http://127.0.0.1/", method: "GET", headers: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each(["http://[::1]/", "http://[::ffff:127.0.0.2]/"])(
    "rejects the private IPv6 literal %s",
    async (url) => {
      await expect(
        proxyRequest({ url, method: "GET", headers: {} }),
      ).rejects.toMatchObject({
        statusCode: 403,
        block: { code: "private-host" },
      });
      await expect(assertPublicUrl(url)).rejects.toMatchObject({
        statusCode: 403,
        block: { code: "private-host" },
      });
    },
  );
});

describe("proxy private-host allow list", () => {
  it("allows exact IPs and IPv4 CIDRs, rejects everything else", () => {
    const allow = buildAllowList(["192.168.0.0/16", "10.1.2.3", "::1"]);

    expect(allowsAddress(allow, "192.168.1.5")).toBe(true);
    expect(allowsAddress(allow, "192.169.0.1")).toBe(false);
    expect(allowsAddress(allow, "10.1.2.3")).toBe(true);
    expect(allowsAddress(allow, "10.1.2.4")).toBe(false);
    expect(allowsAddress(allow, "::1")).toBe(true);
    expect(allowsAddress(allow, "8.8.8.8")).toBe(false);
  });

  it("ignores IPv6 CIDR and malformed entries", () => {
    const allow = buildAllowList(["fd00::/8", "garbage", "192.168.0.0/33"]);

    expect(allow.exact.size).toBe(0);
    expect(allow.cidrV4.length).toBe(0);
    expect(allowsAddress(allow, "fd00::1")).toBe(false);
  });
});
