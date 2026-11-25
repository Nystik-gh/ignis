// Node's http IncomingMessage for client responses.

import { Buffer } from "buffer/";
import { EventEmitter } from "../events.js";
import { STATUS_CODES } from "./status-codes.js";
import { codedError, emitError } from "./errors.js";

function streamingTextDecoder(label) {
  const decoder = new TextDecoder(label, { ignoreBOM: true });

  return {
    write: (buffer) => decoder.decode(buffer, { stream: true }),
    end: () => decoder.decode(),
  };
}

const BASE64_GROUP_BYTES = 3;

function base64Decoder() {
  let carry = Buffer.alloc(0);

  return {
    write(buffer) {
      const bytes = Buffer.concat([carry, buffer]);
      const wholeGroups = bytes.length - (bytes.length % BASE64_GROUP_BYTES);
      carry = bytes.subarray(wholeGroups);

      return bytes.subarray(0, wholeGroups).toString("base64");
    },
    end() {
      const text = carry.toString("base64");
      carry = Buffer.alloc(0);

      return text;
    },
  };
}

function textDecoderFor(encoding) {
  const name = encoding.toLowerCase();

  if (/^utf-?8$/.test(name)) {
    return streamingTextDecoder("utf-8");
  }

  if (/^(utf-?16le|ucs-?2)$/.test(name)) {
    return streamingTextDecoder("utf-16le");
  }

  if (name === "base64") {
    return base64Decoder();
  }

  return { write: (buffer) => buffer.toString(encoding), end: () => "" };
}

export class IncomingMessage extends EventEmitter {
  constructor(req, { status, headers, body }) {
    super();
    this.req = req;
    this.statusCode = status;
    this.statusMessage = STATUS_CODES[status] || "";
    this.httpVersion = "1.1";
    this.headers = {};
    this.complete = false;
    this.aborted = false;
    this.destroyed = false;
    this._reader = body ? body.getReader() : null;
    this._flowing = null;
    this._pumping = false;
    this._pending = undefined;
    this._decoder = null;

    for (const [name, value] of Object.entries(headers || {})) {
      this.headers[name.toLowerCase()] = value;
    }
  }

  on(event, listener) {
    super.on(event, listener);

    if (event === "data" && this._flowing !== false) {
      this.resume();
    }

    return this;
  }

  setEncoding(encoding) {
    this._decoder = textDecoderFor(encoding || "utf8");

    return this;
  }

  pause() {
    this._flowing = false;

    return this;
  }

  resume() {
    this._flowing = true;
    this._pump();

    return this;
  }

  isPaused() {
    return this._flowing === false;
  }

  pipe(destination, { end = true } = {}) {
    this.on("data", (chunk) => {
      if (destination.write(chunk) === false && destination.once) {
        this.pause();
        destination.once("drain", () => this.resume());
      }
    });

    if (end) {
      this.on("end", () => destination.end());
    }

    return destination;
  }

  destroy(error) {
    if (this.complete || this.destroyed) {
      return this;
    }

    this.destroyed = true;
    this.req._stopTransport();

    queueMicrotask(() => {
      this.aborted = true;
      this._reader?.cancel().catch(() => {});
      this.emit("aborted");

      if (error) {
        emitError(this.req, error);
        emitError(this, error);
      }

      this.emit("close");
      this.req._close();
    });

    return this;
  }

  async *[Symbol.asyncIterator]() {
    this._flowing = false;

    try {
      while (true) {
        let chunk;

        try {
          chunk = await this._nextChunk();
        } catch {
          throw codedError("aborted", "ECONNRESET");
        }

        if (chunk === null) {
          this._finish();
          return;
        }

        if (chunk.length > 0) {
          yield chunk;
        }
      }
    } finally {
      if (!this.complete) {
        this.req.destroy();
      }
    }
  }

  async _pump() {
    if (this._pumping) {
      return;
    }

    this._pumping = true;

    while (this._flowing && !this.destroyed) {
      let chunk;

      try {
        chunk = await this._nextChunk();
      } catch {
        this._pumping = false;
        this._abort();
        return;
      }

      if (this.destroyed) {
        break;
      }

      const pausedDuringRead = !this._flowing;

      if (pausedDuringRead) {
        this._pending = chunk;
        break;
      }

      if (chunk === null) {
        this._pumping = false;
        this._finish();
        return;
      }

      if (chunk.length === 0) {
        continue;
      }

      try {
        this.emit("data", chunk);
      } catch (error) {
        this._pumping = false;
        this.req.destroy();
        throw error;
      }
    }

    this._pumping = false;
  }

  async _nextChunk() {
    if (this._pending !== undefined) {
      const chunk = this._pending;
      this._pending = undefined;

      return chunk;
    }

    if (!this._reader) {
      return null;
    }

    const { done, value } = await this._reader.read();

    if (done) {
      return null;
    }

    this.req._restartTimeoutIfPending();

    const buffer = Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );

    return this._decoder ? this._decoder.write(buffer) : buffer;
  }

  _finish() {
    if (this.complete || this.destroyed) {
      return;
    }

    this.complete = true;

    try {
      const tail = this._decoder ? this._decoder.end() : "";

      if (tail) {
        this.emit("data", tail);
      }

      this.emit("end");
    } finally {
      this.req._close();
      this.destroyed = true;
      this.emit("close");
    }
  }

  _abort() {
    if (this.complete || this.aborted) {
      return;
    }

    this.aborted = true;
    this.destroyed = true;
    this._reader?.cancel().catch(() => {});
    this.emit("aborted");
    this.req._close();

    if (this.listenerCount("error") > 0) {
      this.emit("error", codedError("aborted", "ECONNRESET"));
    }

    this.emit("close");
  }
}
