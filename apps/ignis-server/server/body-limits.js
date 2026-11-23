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

function proxyEnvelopeBytes(bodyBytes) {
  const envelope = Math.ceil((bodyBytes * 4) / 3) + PROXY_ENVELOPE_BYTES;

  return Math.min(envelope, LONGEST_PARSEABLE_BODY);
}

function bodyLimits() {
  const parseJson = express.json({ limit: settings.MAX_BODY_BACKSTOP });
  const parseProxyJson = express.json({
    limit: proxyEnvelopeBytes(settings.MAX_BODY_BACKSTOP),
  });

  function checkDeclaredLength(req, res, next) {
    const isProxy = PROXY_PATH.test(req.path);
    const maxBodyBytes = settings.get("maxBodyBytes");
    const limit = isProxy ? proxyEnvelopeBytes(maxBodyBytes) : maxBodyBytes;
    const declared = Number(req.headers["content-length"]);

    if (Number.isFinite(declared) && declared > limit) {
      const body = isProxy
        ? PROXY_BODY_TOO_LARGE
        : { error: "Request body too large" };

      return res.status(413).json(body);
    }

    next();
  }

  function parseBody(req, res, next) {
    const parse = PROXY_PATH.test(req.path) ? parseProxyJson : parseJson;

    parse(req, res, next);
  }

  function answerProxyTooLarge(err, req, res, next) {
    if (err.type === "entity.too.large" && PROXY_PATH.test(req.path)) {
      return res.status(413).json(PROXY_BODY_TOO_LARGE);
    }

    next(err);
  }

  return [checkDeclaredLength, parseBody, answerProxyTooLarge];
}

module.exports = { bodyLimits, proxyEnvelopeBytes, PROXY_BODY_TOO_LARGE };
