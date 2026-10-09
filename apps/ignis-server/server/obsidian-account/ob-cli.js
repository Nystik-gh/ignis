const { spawn, execSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DependencyManager } = require("../plugin-system/dependencies");

const HEADLESS_DEPENDENCY = {
  name: "obsidian-headless",
  version: "0.0.14",
  installScripts: true,
};

const LOGIN_TIMEOUT_MS = 30000;
const LOGIN_KILL_MS = 5000;
const BAD_CREDENTIALS_TEXT = "double check your email and password";
const OVERLOAD_TEXT = "Unexpected token";

let obHome = null;
let cliJs = null;
let dependencyManager = null;

function init(opts) {
  obHome = opts && opts.obHome ? opts.obHome : null;
  dependencyManager = opts?.dataRoot
    ? new DependencyManager(opts.dataRoot, {
        log: (msg) => console.log(`[ob-cli] ${msg}`),
      })
    : null;
  cliJs =
    opts?.cliJs ||
    dependencyManager?.resolveCached(HEADLESS_DEPENDENCY) ||
    null;

  if (obHome) {
    try {
      fs.mkdirSync(obHome, { recursive: true });
    } catch {}
  }
}

function getObHome() {
  return obHome || os.homedir();
}

function authTokenFileIn(home) {
  // ob uses .config on Linux only
  const configDir =
    process.platform === "linux"
      ? path.join(home, ".config", "obsidian-headless")
      : path.join(home, ".obsidian-headless");

  return path.join(configDir, "auth_token");
}

function getAuthTokenFile() {
  return authTokenFileIn(getObHome());
}

function obEnv(home) {
  const env = { ...process.env, HOME: home };

  // make sure ob uses HOME and its token file
  delete env.XDG_CONFIG_HOME;
  delete env.OBSIDIAN_AUTH_TOKEN;

  return env;
}

function checkInstalled() {
  try {
    const options = {
      stdio: "pipe",
      windowsHide: true,
      timeout: 10000,
    };
    const output = (
      cliJs
        ? execFileSync(process.execPath, [cliJs, "--version"], options)
        : execSync("ob --version", options)
    )
      .toString()
      .trim();

    return { installed: true, version: output || "unknown" };
  } catch {
    return { installed: false, version: null };
  }
}

async function ensureInstalled() {
  const installed = checkInstalled();

  if (installed.installed || !dependencyManager) {
    return installed;
  }

  const dependencies = await dependencyManager.prepare([HEADLESS_DEPENDENCY]);
  cliJs = dependencies.resolve(HEADLESS_DEPENDENCY.name);
  return checkInstalled();
}

function useManagedCli(file) {
  cliJs = file;
}

function obCliJs() {
  if (!cliJs) {
    const globalModules = execSync("npm root -g", {
      stdio: "pipe",
      windowsHide: true,
    })
      .toString()
      .trim();

    cliJs = path.join(globalModules, "obsidian-headless", "cli.js");
  }

  return cliJs;
}

function spawnOb(args, opts = {}) {
  const spawnOpts = {
    env: obEnv(getObHome()),
    shell: false,
    windowsHide: true,
    ...opts,
  };

  // windows shell fix
  if (cliJs || process.platform === "win32") {
    return spawn(process.execPath, [obCliJs(), ...args], spawnOpts);
  }

  return spawn("ob", args, spawnOpts);
}

function runCommand(args, opts = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const { input, ...spawnOpts } = opts;
    const proc = spawnOb(args, spawnOpts);

    if (input !== undefined) {
      proc.stdin.end(input);
    }

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`ob ${args[0]} failed (code ${code}): ${stderr || stdout}`),
        );
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

function readTokenFile(file) {
  try {
    return fs.readFileSync(file, "utf-8").trim();
  } catch {
    return "";
  }
}

function classifyLogin({ code, stdout, stderr, email, scratchHome }) {
  if (stderr.includes(BAD_CREDENTIALS_TEXT)) {
    return { outcome: "bad-credentials" };
  }

  if (stderr.includes(OVERLOAD_TEXT)) {
    return { outcome: "overload" };
  }

  if (code !== 0) {
    return {
      outcome: "error",
      message: stderr.trim() || `ob login exited with code ${code}`,
    };
  }

  const token = readTokenFile(authTokenFileIn(scratchHome));

  if (!token) {
    return { outcome: "error", message: "ob login wrote no auth token" };
  }

  const loggedIn = stdout.match(/Logged in as (.+) \(/);

  return {
    outcome: "ok",
    token,
    name: loggedIn ? loggedIn[1] : null,
    email,
  };
}

function login({ email, password, mfa }) {
  const args = ["login", "--email", email];

  if (typeof mfa === "string" && mfa !== "") {
    args.push("--mfa", mfa);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let scratchHome;
    let proc;
    let killTimer = null;

    try {
      // use temp dir to avoid ob sign out
      scratchHome = fs.mkdtempSync(path.join(getObHome(), "login-"));
    } catch (e) {
      resolve({ outcome: "error", message: e.message });
      return;
    }

    function settle(outcome) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);

      try {
        fs.rmSync(scratchHome, { recursive: true, force: true });
      } catch {}

      resolve(outcome);
    }

    const timer = setTimeout(() => {
      timedOut = true;

      if (!proc) {
        settle({ outcome: "error", message: "ob login timed out" });
        return;
      }

      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), LOGIN_KILL_MS);
    }, LOGIN_TIMEOUT_MS);

    const env = obEnv(scratchHome);

    try {
      proc = spawnOb(args, { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      settle({ outcome: "error", message: e.message });
      return;
    }

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (timedOut) {
        settle({ outcome: "error", message: "ob login timed out" });
        return;
      }

      settle(classifyLogin({ code, stdout, stderr, email, scratchHome }));
    });

    proc.on("error", (err) => {
      settle({ outcome: "error", message: err.message });
    });

    proc.stdin.on("error", () => {});

    // use stdin instead of argument for security
    proc.stdin.end(password);
  });
}

module.exports = {
  HEADLESS_DEPENDENCY,
  init,
  getObHome,
  getAuthTokenFile,
  checkInstalled,
  ensureInstalled,
  useManagedCli,
  spawnOb,
  runCommand,
  login,
};
