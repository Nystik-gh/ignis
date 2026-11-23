const { constants } = require("buffer");
const express = require("express");
const settings = require("./settings");

const PROXY_PATH = /^\/api\/proxy\/*$/i;
const PROXY_ENVELOPE_BYTES = 64 * 1024;
const LONGEST_PARSEABLE_BODY = constants.MAX_STRING_LENGTH;

const PROXY_BODY_TOO_LARGE = {
  error:
    "Request body too large (Max request body in Settings > Ignis > General > Security)",
  code: "body-too-large",
};

const PLAIN_BODY_TOO_LARGE = { error: "Request body too large" };

function proxyEnvelopeBytes(bodyBytes) {
  const envelope = Math.ceil((bodyBytes * 4) / 3) + PROXY_ENVELOPE_BYTES;

  return Math.min(envelope, LONGEST_PARSEABLE_BODY);
}

function cachedJsonParser() {
  let cachedLimit = null;
  let cachedParser = null;

  return function parserFor(limit) {
    if (limit !== cachedLimit) {
      cachedLimit = limit;
      cachedParser = express.json({ limit });
    }

    return cachedParser;
  };
}

function bodyLimits() {
  const jsonParserFor = cachedJsonParser();
  const proxyJsonParserFor = cachedJsonParser();

  function isProxy(req) {
    return PROXY_PATH.test(req.path);
  }

  function limitFor(req) {
    const maxBodyBytes = Math.min(
      settings.get("maxBodyBytes"),
      settings.MAX_BODY_BACKSTOP,
    );

    return isProxy(req) ? proxyEnvelopeBytes(maxBodyBytes) : maxBodyBytes;
  }

  function answerTooLarge(req, res) {
    const body = isProxy(req) ? PROXY_BODY_TOO_LARGE : PLAIN_BODY_TOO_LARGE;

    return res.status(413).json(body);
  }

  function checkDeclaredLength(req, res, next) {
    const declared = Number(req.headers["content-length"]);

    if (Number.isFinite(declared) && declared > limitFor(req)) {
      return answerTooLarge(req, res);
    }

    next();
  }

  function parseBody(req, res, next) {
    const parserFor = isProxy(req) ? proxyJsonParserFor : jsonParserFor;

    parserFor(limitFor(req))(req, res, next);
  }

  function answerParsedTooLarge(err, req, res, next) {
    if (err.type === "entity.too.large") {
      return answerTooLarge(req, res);
    }

    next(err);
  }

  return [checkDeclaredLength, parseBody, answerParsedTooLarge];
}

module.exports = { bodyLimits, proxyEnvelopeBytes, PROXY_BODY_TOO_LARGE };
