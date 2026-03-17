// Minimal http/https stub. Plugins needing full http.request won't work,
// but this prevents crashes for plugins that just import the module.

import { EventEmitter } from "./events.js";

export class IncomingMessage extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 0;
  }
}

export class ClientRequest extends EventEmitter {
  constructor() {
    super();
  }

  end() {}
  write() {}
  abort() {}
  destroy() {}
}

export function request(options, callback) {
  const req = new ClientRequest();
  if (callback) {
    req.once("response", callback);
  }

  // Immediately error. real HTTP requests need fetch or the proxy
  setTimeout(() => {
    req.emit(
      "error",
      new Error(
        "http.request is not available in the web version. Use requestUrl() instead.",
      ),
    );
  }, 0);
  return req;
}

export function get(options, callback) {
  const req = request(options, callback);
  req.end();
  return req;
}

export function createServer() {
  throw new Error("http.createServer is not available in the web version.");
}

export const Agent = class {};
export const globalAgent = new Agent();
