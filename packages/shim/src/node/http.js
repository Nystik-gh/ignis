import { ClientRequest } from "./http/client-request.js";
import { IncomingMessage } from "./http/incoming-message.js";
import { STATUS_CODES } from "./http/status-codes.js";

function urlFromOptions(options) {
  const host = options.hostname || options.host || "localhost";
  const bracketedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const port = options.port ? `:${options.port}` : "";

  return new URL(
    `${options.protocol}//${bracketedHost}${port}${options.path || "/"}`,
  );
}

function optionsFromUrl(url) {
  const hasCredentials = url.username !== "" || url.password !== "";

  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    auth: hasCredentials
      ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
      : undefined,
  };
}

function createRequest(defaultProtocol, input, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }

  const merged =
    typeof input === "string" || input instanceof URL
      ? { ...optionsFromUrl(new URL(input)), ...options }
      : { ...input };
  const protocol = merged.protocol || defaultProtocol;

  if (protocol !== defaultProtocol) {
    const error = new TypeError(
      `Protocol "${protocol}" not supported. Expected "${defaultProtocol}"`,
    );
    error.code = "ERR_INVALID_PROTOCOL";
    throw error;
  }

  const req = new ClientRequest(
    urlFromOptions({ ...merged, protocol }),
    merged,
  );

  if (callback) {
    req.once("response", callback);
  }

  return req;
}

class Agent {
  constructor(options) {
    this.options = options || {};
  }

  destroy() {}
}

function createServer() {
  throw new Error("http.createServer is not available in the web version.");
}

function createHttpModule(protocol) {
  function request(input, options, callback) {
    return createRequest(protocol, input, options, callback);
  }

  function get(input, options, callback) {
    const req = request(input, options, callback);
    req.end();

    return req;
  }

  return {
    request,
    get,
    createServer,
    ClientRequest,
    IncomingMessage,
    Agent,
    globalAgent: new Agent(),
    STATUS_CODES,
  };
}

export const http = createHttpModule("http:");
export const https = createHttpModule("https:");
