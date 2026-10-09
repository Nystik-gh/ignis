import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";

const require = createRequire(import.meta.url);

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "signin-test-"));
process.env.DATA_ROOT = DATA_ROOT;
process.env.PROXY_ALLOW_PRIVATE_HOSTS = "127.0.0.1";

const dns = require("dns");
const settings = require("../settings");
const signin = require("./signin.js");
const proxyRouter = require("../routes/proxy");
const express = require("express");

const EMAIL = "user@example.test";
const PASSWORD = "correct-horse-battery-staple";
const NAME = "Test User";
const SIGNIN_URL = "https://api.obsidian.md/user/signin";

const CREDENTIALS = { email: EMAIL, password: PASSWORD, mfa: "" };

const RELAY_SUCCESS = JSON.stringify({
  token: "relayed-token",
  email: EMAIL,
  name: NAME,
  license: "",
});
const LOGIN_FAILED = JSON.stringify({
  error: "Login failed, please double check your email and password.",
});
const OVERLOADED = JSON.stringify({
  error: "server overloaded, please try again later.",
});
const MFA_REQUIRED = JSON.stringify({ error: "Please enter your 2FA code." });
const MFA_INCORRECT = JSON.stringify({ error: "2FA code is incorrect." });
const ERROR_PAGE = "<html><body>502 Bad Gateway</body></html>";

let obLogin;
let relayAgain;

function useOb(installed) {
  signin._setObCli({
    checkInstalled: () => ({ installed, version: "0.0.8" }),
    login: obLogin,
  });
}

function relayedAnswer(status, body) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: Buffer.from(body).toString("base64"),
  };
}

function bodyOf(answer) {
  return Buffer.from(answer.body, "base64").toString("utf8");
}

function warnLines() {
  return console.warn.mock.calls.map((args) => args.join(" "));
}

beforeEach(() => {
  obLogin = vi.fn(async () => ({ outcome: "error", message: "unexpected" }));
  useOb(true);
  signin._setSigninRetryDelayMs(0);

  relayAgain = vi.fn(async () => relayedAnswer(200, OVERLOADED));

  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  signin._setSigninRetryDelayMs(null);
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("signinCredentials", () => {
  const body = JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
    mfa: "123456",
  });

  it("reads the credentials of a sign-in relay", () => {
    expect(
      signin.signinCredentials({ url: SIGNIN_URL, method: "POST", body }),
    ).toEqual({ email: EMAIL, password: PASSWORD, mfa: "123456" });
  });

  it("returns null for every other relayed request", () => {
    const others = [
      { url: SIGNIN_URL, method: "GET", body },
      { url: "https://api.obsidian.md/user/info", method: "POST", body },
      { url: "https://api.example.com/user/signin", method: "POST", body },
      { url: SIGNIN_URL, method: "POST", body, binary: true },
      { url: SIGNIN_URL, method: "POST", body: "<html></html>" },
      { url: SIGNIN_URL, method: "POST", body: undefined },
    ];

    for (const proxyBody of others) {
      expect(signin.signinCredentials(proxyBody), proxyBody.url).toBeNull();
    }
  });
});

describe("the sign-in ladder", () => {
  it("prepares the CLI on demand only when the relay needs a fallback", async () => {
    const ensureInstalled = vi.fn(async () => ({ installed: true }));
    signin._setObCli({
      checkInstalled: () => ({ installed: false }),
      ensureInstalled,
      login: obLogin,
    });
    const success = relayedAnswer(200, JSON.stringify({ token: "relay-token" }));
    expect(await resolve(success)).toBe(success);
    expect(ensureInstalled).not.toHaveBeenCalled();

    obLogin.mockResolvedValue({ outcome: "ok", token: "ob-token", name: NAME });
    const answer = await resolve(relayedAnswer(200, OVERLOADED));
    expect(ensureInstalled).toHaveBeenCalledOnce();
    expect(JSON.parse(bodyOf(answer)).token).toBe("ob-token");
  });

  it("keeps the relay retry available when dependency installation fails", async () => {
    const ensureInstalled = vi.fn(async () => { throw new Error("Offline"); });
    signin._setObCli({
      checkInstalled: () => ({ installed: false }),
      ensureInstalled,
      login: obLogin,
    });
    const answer = await resolve(relayedAnswer(200, OVERLOADED));
    expect(bodyOf(answer)).toBe(OVERLOADED);
    expect(relayAgain).toHaveBeenCalledTimes(2);
    expect(obLogin).not.toHaveBeenCalled();
  });

  const resolve = (relayed) =>
    signin.resolveSignin(CREDENTIALS, relayed, relayAgain);

  it("passes a relayed token through without asking ob", async () => {
    const relayed = relayedAnswer(200, RELAY_SUCCESS);

    expect(await resolve(relayed)).toBe(relayed);
    expect(obLogin).not.toHaveBeenCalled();
    expect(relayAgain).not.toHaveBeenCalled();
  });

  it("returns the relayed rejection when ob reports bad credentials", async () => {
    obLogin.mockResolvedValue({ outcome: "bad-credentials" });

    const answer = await resolve(relayedAnswer(200, LOGIN_FAILED));

    expect(bodyOf(answer)).toBe(LOGIN_FAILED);
    expect(obLogin).toHaveBeenCalledTimes(1);
    expect(obLogin).toHaveBeenCalledWith(CREDENTIALS);
    expect(warnLines()).toEqual([]);
  });

  it("answers a shed relay with the account ob signed in", async () => {
    obLogin.mockResolvedValue({
      outcome: "ok",
      token: "ob-token",
      name: NAME,
      email: "stale@example.test",
    });

    const answer = await resolve(relayedAnswer(200, LOGIN_FAILED));

    expect(answer.status).toBe(200);
    expect(answer.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(bodyOf(answer))).toEqual({
      token: "ob-token",
      email: EMAIL,
      name: NAME,
      license: "",
    });
  });

  it("retries ob three times on overload, then returns the relayed response", async () => {
    obLogin.mockResolvedValue({ outcome: "overload" });

    const answer = await resolve(relayedAnswer(200, OVERLOADED));

    expect(bodyOf(answer)).toBe(OVERLOADED);
    expect(obLogin).toHaveBeenCalledTimes(3);
    expect(warnLines()).toEqual([
      "[proxy] signin: relay shed, ob login failed (overload)",
    ]);
  });

  it("asks ob when the relayed response is not JSON", async () => {
    obLogin.mockResolvedValue({ outcome: "ok", token: "ob-token", name: NAME });

    const answer = await resolve(relayedAnswer(502, ERROR_PAGE));

    expect(JSON.parse(bodyOf(answer)).token).toBe("ob-token");
    expect(obLogin).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unrecognized ob failure", async () => {
    obLogin.mockResolvedValue({ outcome: "error", message: "spawn ENOENT" });

    const answer = await resolve(relayedAnswer(200, LOGIN_FAILED));

    expect(bodyOf(answer)).toBe(LOGIN_FAILED);
    expect(obLogin).toHaveBeenCalledTimes(1);
    expect(warnLines()).toEqual([
      "[proxy] signin: relay shed, ob login failed (error)",
    ]);
  });

  it("retries the relay three times on overload when ob is absent", async () => {
    useOb(false);

    const answer = await resolve(relayedAnswer(200, OVERLOADED));

    expect(bodyOf(answer)).toBe(OVERLOADED);
    expect(relayAgain).toHaveBeenCalledTimes(2);
    expect(obLogin).not.toHaveBeenCalled();
    expect(warnLines()).toEqual([
      "[proxy] signin: relay shed, ob not installed (overloaded)",
    ]);
  });

  it("returns a rejection on the first attempt when ob is absent", async () => {
    useOb(false);

    const answer = await resolve(relayedAnswer(200, LOGIN_FAILED));

    expect(bodyOf(answer)).toBe(LOGIN_FAILED);
    expect(relayAgain).not.toHaveBeenCalled();
  });

  it("stops retrying the relay once it succeeds", async () => {
    useOb(false);
    relayAgain.mockResolvedValueOnce(relayedAnswer(200, RELAY_SUCCESS));

    const answer = await resolve(relayedAnswer(200, OVERLOADED));

    expect(bodyOf(answer)).toBe(RELAY_SUCCESS);
    expect(relayAgain).toHaveBeenCalledTimes(1);
    expect(warnLines()).toEqual([]);
  });

  it("passes a 2FA challenge through, installed or not", async () => {
    for (const installed of [true, false]) {
      useOb(installed);

      const answer = await resolve(relayedAnswer(200, MFA_REQUIRED));

      expect(bodyOf(answer), `ob installed: ${installed}`).toBe(MFA_REQUIRED);
    }

    expect(obLogin).not.toHaveBeenCalled();
    expect(relayAgain).not.toHaveBeenCalled();
    expect(warnLines()).toEqual([]);
  });

  it("passes a wrong 2FA code through, installed or not", async () => {
    for (const installed of [true, false]) {
      useOb(installed);

      const answer = await resolve(relayedAnswer(200, MFA_INCORRECT));

      expect(bodyOf(answer), `ob installed: ${installed}`).toBe(MFA_INCORRECT);
    }

    expect(obLogin).not.toHaveBeenCalled();
    expect(relayAgain).not.toHaveBeenCalled();
    expect(warnLines()).toEqual([]);
  });

  it("keeps the credentials out of the warning", async () => {
    obLogin.mockResolvedValue({ outcome: "overload" });

    await resolve(relayedAnswer(200, OVERLOADED));

    const logged = warnLines().join("\n");

    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(PASSWORD);
  });
});

describe("the proxy route", () => {
  let server;
  let base;
  let upstream;
  let upstreamPort;

  const realPromisesLookup = dns.promises.lookup;
  const realLookup = dns.lookup;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/proxy", proxyRouter);

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });

    base = `http://127.0.0.1:${server.address().port}`;

    upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(LOGIN_FAILED);
    });

    await new Promise((resolve) => {
      upstream.listen(0, resolve);
    });

    upstreamPort = upstream.address().port;
  });

  afterAll(() => {
    if (server) {
      server.close();
    }

    if (upstream) {
      upstream.close();
    }

    dns.promises.lookup = realPromisesLookup;
    dns.lookup = realLookup;
  });

  beforeEach(() => {
    settings.update({ proxyMode: "any", proxyAllowlist: [] });

    dns.promises.lookup = async () => [{ address: "127.0.0.1", family: 4 }];
    dns.lookup = (hostname, options, callback) =>
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
  });

  it("answers a shed sign-in with the account ob signed in", async () => {
    obLogin.mockResolvedValue({ outcome: "ok", token: "ob-token", name: NAME });

    const res = await fetch(`${base}/api/proxy/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `http://api.obsidian.md:${upstreamPort}/user/signin`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CREDENTIALS),
      }),
    });
    const answer = await res.json();

    expect(res.status).toBe(200);
    expect(JSON.parse(bodyOf(answer))).toEqual({
      token: "ob-token",
      email: EMAIL,
      name: NAME,
      license: "",
    });
  });
});
