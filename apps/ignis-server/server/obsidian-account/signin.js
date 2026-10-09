let obCli = require("./ob-cli");

const SIGNIN_HOST = "api.obsidian.md";
const SIGNIN_PATH = "/user/signin";
const SIGNIN_ATTEMPTS = 3;
const SIGNIN_RETRY_DELAY_MS = 5000;

let signinRetryDelayMs = SIGNIN_RETRY_DELAY_MS;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signinCredentials({ url, method, body, binary }) {
  if (binary || (method || "").toUpperCase() !== "POST") {
    return null;
  }

  if (typeof body !== "string") {
    return null;
  }

  const target = new URL(url);

  if (target.hostname !== SIGNIN_HOST || target.pathname !== SIGNIN_PATH) {
    return null;
  }

  try {
    const { email, password, mfa } = JSON.parse(body);

    return { email, password, mfa };
  } catch {
    return null;
  }
}

function classifySignin(relayed) {
  let parsed;

  try {
    parsed = JSON.parse(Buffer.from(relayed.body, "base64").toString("utf8"));
  } catch {
    return "broken";
  }

  if (parsed && parsed.token) {
    return "success";
  }

  if (relayed.status < 200 || relayed.status > 299) {
    return "broken";
  }

  const message =
    parsed && typeof parsed.error === "string"
      ? parsed.error.toLowerCase()
      : "";

  if (message.includes("2fa code")) {
    return "mfa";
  }

  if (message.includes("double check your email and password")) {
    return "login-failed";
  }

  if (message.includes("overloaded")) {
    return "overloaded";
  }

  return "broken";
}

function signedInResponse(login, email) {
  const account = JSON.stringify({
    token: login.token,
    email,
    name: login.name,
    license: "",
  });

  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(account).toString("base64"),
  };
}

async function retryRelay(relayAgain, relayed) {
  let latest = relayed;
  let outcome = "";

  for (let attempt = 2; attempt <= SIGNIN_ATTEMPTS; attempt++) {
    await sleep(signinRetryDelayMs);
    latest = await relayAgain();
    outcome = classifySignin(latest);

    if (
      outcome === "success" ||
      outcome === "mfa" ||
      outcome === "login-failed"
    ) {
      return latest;
    }
  }

  console.warn(`[proxy] signin: relay shed, ob not installed (${outcome})`);
  return latest;
}

async function retryWithOb(credentials, relayed, relayOverloaded) {
  let failure = "";

  for (let attempt = 1; attempt <= SIGNIN_ATTEMPTS; attempt++) {
    const login = await obCli.login(credentials);

    if (login.outcome === "ok") {
      return signedInResponse(login, credentials.email);
    }

    if (login.outcome === "bad-credentials") {
      return relayed;
    }

    failure = login.outcome;

    if (failure !== "overload" && !relayOverloaded) {
      break;
    }

    if (attempt < SIGNIN_ATTEMPTS) {
      await sleep(signinRetryDelayMs);
    }
  }

  console.warn(`[proxy] signin: relay shed, ob login failed (${failure})`);
  return relayed;
}

async function resolveSignin(credentials, relayed, relayAgain) {
  const outcome = classifySignin(relayed);

  if (outcome === "success" || outcome === "mfa") {
    return relayed;
  }

  let installed = obCli.checkInstalled().installed;

  // Install the fallback CLI only when the relay actually needs it.
  if (!installed && outcome !== "login-failed" && obCli.ensureInstalled) {
    try {
      installed = (await obCli.ensureInstalled()).installed;
    } catch (e) {
      console.warn(`[proxy] signin: could not prepare ob CLI: ${e.message}`);
    }
  }

  if (!installed) {
    if (outcome === "login-failed") {
      return relayed;
    }

    return retryRelay(relayAgain, relayed);
  }

  return retryWithOb(credentials, relayed, outcome === "overloaded");
}

// Test-only.
function _setSigninRetryDelayMs(ms) {
  signinRetryDelayMs = ms ?? SIGNIN_RETRY_DELAY_MS;
}

// Test-only.
function _setObCli(stub) {
  obCli = stub;
}

module.exports = {
  signinCredentials,
  resolveSignin,
  _setSigninRetryDelayMs,
  _setObCli,
};
