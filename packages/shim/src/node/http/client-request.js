// Node's http ClientRequest.

import { Buffer } from "buffer/";
import { EventEmitter } from "../events.js";
import { sendStreamingRequest } from "../../util/send-request.js";
import { IncomingMessage } from "./incoming-message.js";
import { codedError, abortError, emitError } from "./errors.js";

export class ClientRequest extends EventEmitter {
  constructor(url, options) {
    super();
    this.method = (options.method || "GET").toUpperCase();
    this.protocol = url.protocol;
    this.host = url.hostname;
    this.path = url.pathname + url.search;
    this.res = null;
    this.aborted = false;
    this.destroyed = false;
    this.writableEnded = false;
    this.writableFinished = false;
    this._url = url.href;
    this._headers = new Map();
    this._chunks = [];
    this._controller = new AbortController();
    this._closed = false;
    this._timeoutMs = 0;
    this._timer = null;
    this._signal = null;
    this._onSignalAbort = null;

    for (const [name, value] of Object.entries(options.headers || {})) {
      this.setHeader(name, value);
    }

    if (options.auth && !this.hasHeader("authorization")) {
      this.setHeader(
        "Authorization",
        `Basic ${Buffer.from(options.auth).toString("base64")}`,
      );
    }

    if (options.timeout) {
      this.setTimeout(options.timeout);
    }

    if (options.signal) {
      this._followSignal(options.signal);
    }
  }

  setHeader(name, value) {
    this._headers.set(name.toLowerCase(), { name, value });

    return this;
  }

  getHeader(name) {
    return this._headers.get(name.toLowerCase())?.value;
  }

  hasHeader(name) {
    return this._headers.has(name.toLowerCase());
  }

  removeHeader(name) {
    this._headers.delete(name.toLowerCase());
  }

  getHeaders() {
    const headers = {};

    for (const [key, { value }] of this._headers) {
      headers[key] = value;
    }

    return headers;
  }

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    if (this.writableEnded) {
      const error = codedError("write after end", "ERR_STREAM_WRITE_AFTER_END");
      queueMicrotask(() => {
        emitError(this, error);
        callback?.(error);
      });

      return false;
    }

    this._chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk, encoding)
        : Buffer.from(chunk),
    );

    if (callback) {
      queueMicrotask(callback);
    }

    return true;
  }

  end(chunk, encoding, callback) {
    if (typeof chunk === "function") {
      callback = chunk;
      chunk = undefined;
    } else if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    if (this.writableEnded) {
      return this;
    }

    if (chunk != null) {
      this.write(chunk, encoding);
    }

    this.writableEnded = true;

    if (callback) {
      this.once("finish", callback);
    }

    queueMicrotask(() => this._send());

    return this;
  }

  setTimeout(ms, callback) {
    this._timeoutMs = ms;

    if (callback) {
      this.once("timeout", callback);
    }

    if (this.writableFinished && !this._closed) {
      this._startTimeout();
    }

    return this;
  }

  flushHeaders() {}

  setNoDelay() {}

  setSocketKeepAlive() {}

  abort() {
    if (this.aborted) {
      return;
    }

    this.aborted = true;
    queueMicrotask(() => this.emit("abort"));
    this.destroy();
  }

  destroy(error) {
    if (this.destroyed) {
      return this;
    }

    this._stopTransport();

    const res = this.res;

    queueMicrotask(() => {
      if (!res) {
        emitError(this, error || codedError("socket hang up", "ECONNRESET"));
        this._close();
        return;
      }

      if (error) {
        emitError(this, error);
      }

      res._abort();
    });

    return this;
  }

  async _send() {
    if (this.destroyed) {
      return;
    }

    const headers = {};

    for (const { name, value } of this._headers.values()) {
      headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }

    const body = Buffer.concat(this._chunks);
    const sending = sendStreamingRequest({
      url: this._url,
      method: this.method,
      headers,
      body: body.length > 0 ? body : undefined,
      signal: this._controller.signal,
    });

    this._chunks = [];
    this._startTimeout();
    this.writableFinished = true;
    this.emit("finish");

    let response;

    try {
      response = await sending;
    } catch (error) {
      if (!this.destroyed) {
        this.destroyed = true;
        this._clearTimeout();
        emitError(this, error);
        this._close();
      }

      return;
    }

    if (this.destroyed) {
      return;
    }

    this._restartTimeoutIfPending();
    this.res = new IncomingMessage(this, response);

    if (!this.emit("response", this.res)) {
      this.res.resume();
    }
  }

  _followSignal(signal) {
    if (signal.aborted) {
      this.destroy(abortError());
      return;
    }

    this._signal = signal;
    this._onSignalAbort = () => this.destroy(abortError());
    signal.addEventListener("abort", this._onSignalAbort, { once: true });
  }

  _stopTransport() {
    this.destroyed = true;
    this._clearTimeout();
    this._controller.abort();
  }

  _startTimeout() {
    this._clearTimeout();

    if (this._timeoutMs > 0) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this.emit("timeout");
      }, this._timeoutMs);
    }
  }

  _restartTimeoutIfPending() {
    if (this._timer) {
      this._startTimeout();
    }
  }

  _clearTimeout() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  _close() {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this.destroyed = true;
    this._clearTimeout();
    this._signal?.removeEventListener("abort", this._onSignalAbort);
    this.emit("close");
  }
}
