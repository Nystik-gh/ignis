import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const childProcess = require("node:child_process");
const realSpawn = childProcess.spawn;

const obRuns = [];
let scriptedRun = null;

function authTokenFileIn(home) {
  const configDir =
    process.platform === "linux"
      ? path.join(home, ".config", "obsidian-headless")
      : path.join(home, ".obsidian-headless");

  return path.join(configDir, "auth_token");
}

function createStdin() {
  const chunks = [];

  return {
    chunks,
    on() {},
    write(chunk) {
      chunks.push(String(chunk));
    },
    end(chunk) {
      if (chunk !== undefined) {
        chunks.push(String(chunk));
      }
    },
  };
}

function obArgs(command, args) {
  if (command === "ob") {
    return args;
  }

  if (
    command === process.execPath &&
    /obsidian-headless[\\/]cli\.js$/.test(args[0])
  ) {
    return args.slice(1);
  }

  return null;
}

// mock ob cli
childProcess.spawn = (command, args, opts) => {
  const runArgs = obArgs(command, args);

  if (!runArgs) {
    return realSpawn(command, args, opts);
  }

  const proc = new EventEmitter();

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = createStdin();
  proc.killed = false;
  proc.signals = [];
  proc.kill = (signal) => {
    proc.signals.push(signal);

    if (signal === "SIGKILL" || !(scriptedRun && scriptedRun.ignoresTerm)) {
      proc.killed = true;
      proc.emit("close", null);
    }
  };

  obRuns.push({
    command,
    args: runArgs,
    opts,
    proc,
    tokenInHome: fs.existsSync(authTokenFileIn(opts.env.HOME)),
  });

  const script = scriptedRun;

  if (script && script.code !== undefined) {
    setImmediate(() => {
      if (script.token) {
        const file = authTokenFileIn(opts.env.HOME);

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, script.token, "utf-8");
      }

      if (script.stdout) {
        proc.stdout.emit("data", Buffer.from(script.stdout));
      }

      if (script.stderr) {
        proc.stderr.emit("data", Buffer.from(script.stderr));
      }

      proc.emit("close", script.code);
    });
  }

  return proc;
};

// force use of mocked ob cli
delete require.cache[require.resolve("./ob-cli.js")];
const obCli = require("./ob-cli.js");
const auth = require("../plugins/headless-sync/auth.js");

const BAD_CREDENTIALS_STDERR = `Login failed: Error: Login failed, please double check your email and password.
    at login (/usr/lib/node_modules/obsidian-headless/cli.js:1:1)
`;

const OVERLOAD_STDERR = `Login failed: SyntaxError: Unexpected token '<', "<!DOCTYPE " is not valid JSON
    at parseJSONFromBytes (node:internal/deps/undici/undici:1:1)
`;

const SUCCESS_STDOUT = "Logged in as Test User (user@example.test)\n";

const CREDENTIALS = { email: "user@example.test", password: "hunter2" };

let obHome;
let dataDir;
let realPlatform;
let realXdgConfigHome;

function setPlatform(value) {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

function writeAuthToken(token) {
  const file = obCli.getAuthTokenFile();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, "utf-8");
}

function scratchHomes() {
  return fs.readdirSync(obHome).filter((name) => name.startsWith("login-"));
}

beforeAll(() => {
  realPlatform = process.platform;
  setPlatform("linux");

  realXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(os.tmpdir(), "ignis-xdg");

  obHome = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-ob-home-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignis-ob-data-"));

  obCli.init({ obHome });
});

afterAll(() => {
  setPlatform(realPlatform);
  childProcess.spawn = realSpawn;

  if (realXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = realXdgConfigHome;
  }

  fs.rmSync(obHome, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  obRuns.length = 0;
  scriptedRun = null;

  fs.rmSync(obCli.getAuthTokenFile(), { force: true });
});

describe("getObHome", () => {
  it("returns the configured home", () => {
    expect(obCli.getObHome()).toBe(obHome);
  });

  it("falls back to the user home when none is configured", () => {
    try {
      obCli.init({});
      expect(obCli.getObHome()).toBe(os.homedir());
    } finally {
      obCli.init({ obHome });
    }
  });
});

describe("getAuthTokenFile", () => {
  it("uses the XDG config directory on Linux", () => {
    expect(obCli.getAuthTokenFile()).toBe(
      path.join(obHome, ".config", "obsidian-headless", "auth_token"),
    );
  });

  it("uses the dotted directory on Windows", () => {
    try {
      setPlatform("win32");
      expect(obCli.getAuthTokenFile()).toBe(
        path.join(obHome, ".obsidian-headless", "auth_token"),
      );
    } finally {
      setPlatform("linux");
    }
  });

  it("is where headless-sync writes and reads the token", () => {
    auth.saveToken(dataDir, { token: "t-1", email: null, name: null });

    expect(fs.readFileSync(obCli.getAuthTokenFile(), "utf-8")).toBe("t-1");

    fs.rmSync(path.join(dataDir, "auth-token.json"), { force: true });

    expect(auth.loadToken(dataDir)).toEqual({ token: "t-1" });
  });
});

describe("spawnOb", () => {
  it("runs a managed CLI with Node without depending on a global ob binary", () => {
    try {
      obCli.useManagedCli(path.join(dataDir, "node_modules", "obsidian-headless", "cli.js"));
      obCli.spawnOb(["sync-list-remote"]);
      expect(obRuns[0].command).toBe(process.execPath);
      expect(obRuns[0].args).toEqual(["sync-list-remote"]);
      expect(obRuns[0].opts.env.HOME).toBe(obHome);
    } finally {
      obCli.init({ obHome });
    }
  });

  it("runs ob without XDG_CONFIG_HOME", () => {
    obCli.spawnOb(["sync-list-remote"]);

    expect(obRuns[0].opts.env.HOME).toBe(obHome);
    expect("XDG_CONFIG_HOME" in obRuns[0].opts.env).toBe(false);
  });
});

describe("login", () => {
  it("resolves ok with the token and the parsed name", async () => {
    scriptedRun = {
      stdout: SUCCESS_STDOUT,
      stderr: "",
      code: 0,
      token: "secret-token\n",
    };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "ok",
      token: "secret-token",
      name: "Test User",
      email: "user@example.test",
    });
  });

  it("returns the token ob earned without touching the configured home", async () => {
    writeAuthToken("stale-token");
    scriptedRun = {
      stdout: SUCCESS_STDOUT,
      stderr: "",
      code: 0,
      token: "fresh-token\n",
    };

    const outcome = await obCli.login(CREDENTIALS);

    expect(outcome.token).toBe("fresh-token");
    expect(fs.readFileSync(obCli.getAuthTokenFile(), "utf-8")).toBe(
      "stale-token",
    );
  });

  it("escalates to SIGKILL when ob ignores SIGTERM after the bound", async () => {
    vi.useFakeTimers();
    scriptedRun = { ignoresTerm: true };

    try {
      const pending = obCli.login(CREDENTIALS);

      await vi.advanceTimersByTimeAsync(30000);
      expect(obRuns[0].proc.signals).toEqual(["SIGTERM"]);
      expect(obRuns[0].proc.killed).toBe(false);

      await vi.advanceTimersByTimeAsync(5000);

      expect(obRuns[0].proc.signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(await pending).toEqual({
        outcome: "error",
        message: "ob login timed out",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves error when no token file was written", async () => {
    scriptedRun = { stdout: SUCCESS_STDOUT, stderr: "", code: 0 };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "error",
      message: "ob login wrote no auth token",
    });
  });

  it("resolves error when the token file is empty", async () => {
    scriptedRun = {
      stdout: SUCCESS_STDOUT,
      stderr: "",
      code: 0,
      token: "   \n",
    };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "error",
      message: "ob login wrote no auth token",
    });
  });

  it("resolves bad-credentials on the rejected-password stderr", async () => {
    scriptedRun = { stdout: "", stderr: BAD_CREDENTIALS_STDERR, code: 1 };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "bad-credentials",
    });
  });

  it("resolves overload on the HTML-parse stderr", async () => {
    scriptedRun = { stdout: "", stderr: OVERLOAD_STDERR, code: 1 };

    expect(await obCli.login(CREDENTIALS)).toEqual({ outcome: "overload" });
  });

  it("resolves error with the stderr of an unrecognized failure", async () => {
    scriptedRun = { stdout: "", stderr: "getaddrinfo ENOTFOUND\n", code: 1 };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "error",
      message: "getaddrinfo ENOTFOUND",
    });
  });

  it("resolves error with the exit code when a failure printed nothing", async () => {
    scriptedRun = { stdout: "", stderr: "", code: 7 };

    expect(await obCli.login(CREDENTIALS)).toEqual({
      outcome: "error",
      message: "ob login exited with code 7",
    });
  });

  it("resolves error when the spawn fails", async () => {
    const pending = obCli.login(CREDENTIALS);

    obRuns[0].proc.emit("error", new Error("spawn ob ENOENT"));

    expect(await pending).toEqual({
      outcome: "error",
      message: "spawn ob ENOENT",
    });
  });

  it("kills ob and resolves error once the bound expires", async () => {
    vi.useFakeTimers();

    try {
      const pending = obCli.login(CREDENTIALS);

      await vi.advanceTimersByTimeAsync(30000);

      expect(await pending).toEqual({
        outcome: "error",
        message: "ob login timed out",
      });
      expect(obRuns[0].proc.killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes --mfa only when a code was supplied", async () => {
    scriptedRun = { stdout: "", stderr: BAD_CREDENTIALS_STDERR, code: 1 };

    await obCli.login({ ...CREDENTIALS, mfa: "123456" });
    await obCli.login({ ...CREDENTIALS, mfa: "" });
    await obCli.login(CREDENTIALS);

    expect(obRuns[0].args).toEqual([
      "login",
      "--email",
      "user@example.test",
      "--mfa",
      "123456",
    ]);
    expect(obRuns[1].args).toEqual(["login", "--email", "user@example.test"]);
    expect(obRuns[2].args).toEqual(["login", "--email", "user@example.test"]);
  });

  it("sends the password on stdin and keeps it off the argument list", async () => {
    scriptedRun = { stdout: "", stderr: BAD_CREDENTIALS_STDERR, code: 1 };

    await obCli.login(CREDENTIALS);

    expect(obRuns[0].proc.stdin.chunks).toEqual(["hunter2"]);
    expect(obRuns[0].args).not.toContain("hunter2");
    expect(obRuns[0].opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("runs ob against a home of its own, with no token in reach", async () => {
    writeAuthToken("live-token");
    scriptedRun = { stdout: "", stderr: BAD_CREDENTIALS_STDERR, code: 1 };

    process.env.OBSIDIAN_AUTH_TOKEN = "live-token";

    try {
      await obCli.login(CREDENTIALS);
    } finally {
      delete process.env.OBSIDIAN_AUTH_TOKEN;
    }

    const { env } = obRuns[0].opts;

    expect(env.HOME).not.toBe(obHome);
    expect(path.dirname(env.HOME)).toBe(obHome);
    expect(path.basename(env.HOME).startsWith("login-")).toBe(true);
    expect(obRuns[0].tokenInHome).toBe(false);
    expect("XDG_CONFIG_HOME" in env).toBe(false);
    expect("OBSIDIAN_AUTH_TOKEN" in env).toBe(false);
  });

  it("leaves a token it did not replace alone", async () => {
    const failures = [
      { stderr: BAD_CREDENTIALS_STDERR, code: 1 },
      { stderr: OVERLOAD_STDERR, code: 1 },
      { stderr: "getaddrinfo ENOTFOUND", code: 1 },
      { stdout: SUCCESS_STDOUT, stderr: "", code: 0 },
    ];

    for (const failure of failures) {
      writeAuthToken("live-token");
      scriptedRun = { stdout: "", ...failure };

      const { outcome } = await obCli.login(CREDENTIALS);

      expect(outcome).not.toBe("ok");
      expect(fs.readFileSync(obCli.getAuthTokenFile(), "utf-8")).toBe(
        "live-token",
      );
    }
  });

  it("leaves no scratch home behind, whatever the outcome", async () => {
    const runs = [
      { stdout: SUCCESS_STDOUT, stderr: "", code: 0, token: "fresh-token" },
      { stdout: "", stderr: BAD_CREDENTIALS_STDERR, code: 1 },
      { stdout: "", stderr: OVERLOAD_STDERR, code: 1 },
      { stdout: "", stderr: "getaddrinfo ENOTFOUND", code: 1 },
    ];

    for (const run of runs) {
      scriptedRun = run;

      await obCli.login(CREDENTIALS);

      expect(scratchHomes()).toEqual([]);
    }
  });

  it("leaves no scratch home behind when the bound expires", async () => {
    vi.useFakeTimers();

    try {
      const pending = obCli.login(CREDENTIALS);

      await vi.advanceTimersByTimeAsync(30000);
      await pending;

      expect(scratchHomes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no scratch home behind when the spawn fails", async () => {
    const pending = obCli.login(CREDENTIALS);

    obRuns[0].proc.emit("error", new Error("spawn ob ENOENT"));
    await pending;

    expect(scratchHomes()).toEqual([]);
  });
});
