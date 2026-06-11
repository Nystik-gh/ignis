// Auth routes: /api/auth/login, /api/auth/logout, /api/auth/status

const express = require("express");
const config = require("../config");
const {
  verifyPassword,
  verifyApiKey,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  getSession,
  COOKIE_NAME,
} = require("../auth");

const router = express.Router();

// POST /api/auth/login — authenticate and set session cookie.
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  if (!config.authUser) {
    return res.status(400).json({ error: "Authentication is not configured" });
  }

  if (username !== config.authUser) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (!verifyPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const sessionId = createSession(username);
  setSessionCookie(res, sessionId);

  return res.json({ success: true, username });
});

// POST /api/auth/logout — clear session cookie.
router.post("/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];

  if (sessionId) {
    // Session map is imported directly from auth module
    const { sessions } = require("../auth");
    sessions.delete(sessionId);
  }

  clearSessionCookie(res);

  return res.json({ success: true });
});

// GET /api/auth/status — check if authenticated, return username if so.
router.get("/status", (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];

  if (sessionId) {
    const s = getSession(sessionId);

    if (s) {
      return res.json({ authenticated: true, username: s.username });
    }
  }

  return res.json({ authenticated: false });
});

module.exports = router;
