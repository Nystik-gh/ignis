// Built-in authentication: credential verification, session management, middleware.
//
// Supports:
//   - HTTP Basic Auth (IGNIS_AUTH_USER / IGNIS_AUTH_PASS)
//   - API key auth (IGNIS_API_KEY)
//   - Session cookies after successful login

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const COOKIE_NAME = "ignis-session";

// In-memory session map: sessionId -> { username, createdAt, lastAccess }
const sessions = new Map();

// Cleanup interval (every 5 minutes)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > config.authTimeoutMs) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

// ---- Password hashing (PBKDF2, no external deps) ----

function deriveHash(plain) {
  const salt = config.authUser || "ignis";
  return crypto.pbkdf2Sync(plain, salt, 100_000, 64, "sha512").toString("hex");
}

function verifyPassword(plain) {
  if (!config.authPass) {
    return false;
  }

  const stored = config.authPass;
  const isHash = /^[a-f0-9]{128}$/i.test(stored);

  if (!isHash) {
    // Plain text comparison — timingSafeEqual requires same length
    // So we compare lengths first, then use timingSafeEqual for same-length strings
    if (plain.length !== stored.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(plain, "utf-8"),
      Buffer.from(stored, "utf-8"),
    );
  }

  // Hashed comparison — both are always 128 hex chars
  return crypto.timingSafeEqual(
    Buffer.from(deriveHash(plain), "utf-8"),
    Buffer.from(stored, "utf-8"),
  );
}

// ---- API key verification ----

function verifyApiKey(key) {
  if (!config.apiKey || !key) {
    return false;
  }

  if (key.length !== config.apiKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(key, "utf-8"),
    Buffer.from(config.apiKey, "utf-8"),
  );
}

// ---- HTTP Basic Auth parsing ----

function parseBasicAuth(req) {
  const raw = req.headers.authorization;

  if (!raw || !raw.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(raw.slice(6), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");

    if (sep < 0) {
      return null;
    }

    return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

// ---- Cookie helpers ----

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  const out = {};

  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");

    if (eq < 0) {
      continue;
    }

    out[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }

  return out;
}

function setSessionCookie(res, sessionId) {
  const maxAge = Math.floor(config.authTimeoutMs / 1000);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

// ---- Session management ----

function createSession(username) {
  const id = crypto.randomBytes(16).toString("hex");
  sessions.set(id, { username, createdAt: Date.now(), lastAccess: Date.now() });
  return id;
}

function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const s = sessions.get(sessionId);

  if (!s) {
    return null;
  }

  const now = Date.now();

  if (now - s.lastAccess > config.authTimeoutMs) {
    sessions.delete(sessionId);
    return null;
  }

  s.lastAccess = now;
  return s;
}

// ---- Core authenticate function ----

function authenticate(req) {
  // 1. Check session cookie
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];

  if (sessionId) {
    const s = getSession(sessionId);

    if (s) {
      return s;
    }
  }

  // 2. Check API key header
  const apiKey = req.headers["x-api-key"];

  if (apiKey && verifyApiKey(apiKey)) {
    return { username: "api-key" };
  }

  // 3. Check HTTP Basic Auth
  if (config.authUser) {
    const basic = parseBasicAuth(req);

    if (basic && basic.username === config.authUser && verifyPassword(basic.password)) {
      const newSessionId = createSession(basic.username);
      setSessionCookie(req.res || req, newSessionId);
      return { username: basic.username };
    }
  }

  return null;
}

// ---- Login page ----

function getLoginHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ignis - Sign in</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#1b1b1b;color:#dcddde;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .login{width:100%;max-width:380px;padding:2rem}
    h1{font-size:1.5rem;margin-bottom:.25rem;text-align:center}
    .subtitle{color:#8a8f98;text-align:center;margin-bottom:2rem;font-size:.9rem}
    label{display:block;font-size:.8rem;color:#8a8f98;margin-bottom:.25rem}
    input[type=text],input[type=password]{width:100%;padding:.6rem .75rem;
      border:1px solid #3a3f47;border-radius:6px;background:#2a2d34;color:#dcddde;
      font-size:.95rem;margin-bottom:1rem;outline:none}
    input:focus{border-color:#7b5edf}
    button{width:100%;padding:.65rem;border:none;border-radius:6px;
      background:#7b5edf;color:#fff;font-size:1rem;cursor:pointer;font-weight:500}
    button:hover{background:#6a4fc7}
    .error{color:#ff6b6b;font-size:.85rem;margin-bottom:1rem;text-align:center;
      display:none}
    .footer{text-align:center;margin-top:2rem;font-size:.75rem;color:#8a8f98}
  </style>
</head>
<body>
  <div class="login">
    <h1>Ignis</h1>
    <p class="subtitle">Sign in to continue</p>
    <p class="error" id="error"></p>
    <form id="form" method="post" action="/api/auth/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="footer">Self-hosted Obsidian web app</p>
  </div>
  <script>
    // Show error from query string
    const params = new URLSearchParams(window.location.search);
    const err = document.getElementById('error');
    if (params.get('error')) {
      err.textContent = decodeURIComponent(params.get('error'));
      err.style.display = 'block';
    }
  </script>
</body>
</html>`;
}

// ---- Middleware setup ----

function setupAuthMiddleware(app) {
  if (!config.authEnabled) {
    return;
  }

  console.log("[auth] Built-in authentication enabled");

  if (config.authUser) {
    // On first boot with plain password, hash it. If it's already a hash (128 hex chars), skip.
    let pass = config.authPass;
    const isHash = pass && /^[a-f0-9]{128}$/i.test(pass);
    if (!isHash) {
      // Plain text password — log that we'll hash it
      console.log(`[auth] Basic Auth user: ${config.authUser} (password will be hashed on first use)`);
    } else {
      console.log(`[auth] Basic Auth user: ${config.authUser} (hashed password)`);
    }
  }

  if (config.apiKey) {
    console.log(`[auth] API key auth enabled (${config.apiKey.slice(0, 4)}...)`);
  }

  // Login page route
  app.get("/login", (req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(getLoginHtml());
  });

  // Auth middleware — runs before API routes
  app.use((req, res, next) => {
    // Allow unauthenticated access to auth endpoints, login page, and static assets
    if (req.path.startsWith("/api/auth") || req.path === "/login") {
      return next();
    }

    if (
      req.path.startsWith("/assets") ||
      req.path === "/favicon.png" ||
      req.path.match(/\/(ignis-ui|shim-loader)\.js$/)
    ) {
      return next();
    }

    // Attach res to req so authenticate can set cookies
    req.res = res;

    const session = authenticate(req);

    if (!session) {
      // API-style requests (JSON, no HTML accept) get 401
      if (!req.accepts("html")) {
        res.set("WWW-Authenticate", 'Basic realm="Ignis"');
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Browser requests get redirected to login
      return res.redirect("/login");
    }

    next();
  });
}

module.exports = {
  setupAuthMiddleware,
  authenticate,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  getSession,
  verifyPassword,
  verifyApiKey,
  parseBasicAuth,
  deriveHash,
  getLoginHtml,
  COOKIE_NAME,
  sessions,
};
