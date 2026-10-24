import { processShim } from "../process.js";
import { EventEmitter } from "./events.js";

let warned = false;

function warnNoDataFlow(method) {
  if (warned) {
    return;
  }

  warned = true;
  console.warn(
    `[shim:stream] ${method}() called, but stream data flow is not implemented. ` +
      "This plugin needs the full stream shim.",
  );
}

export function Stream() {
  EventEmitter.call(this);
}

Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);

Stream.prototype.pipe = function (destination) {
  warnNoDataFlow("pipe");
  return destination;
};

export function pipeline(...streams) {
  warnNoDataFlow("pipeline");

  const callback =
    typeof streams[streams.length - 1] === "function" ? streams.pop() : null;

  if (callback) {
    processShim.nextTick(
      callback,
      new Error(
        "stream.pipeline() failed: stream data flow is not implemented in the web version.",
      ),
    );
  }

  return streams[streams.length - 1];
}

export class Readable extends Stream {
  constructor(options) {
    super();
    this.readable = true;
    this._readableState = { options: options || {} };
  }

  read() {
    warnNoDataFlow("read");
    return null;
  }

  push() {
    warnNoDataFlow("push");
    return false;
  }

  _read() {}
}

export class Writable extends Stream {
  constructor(options) {
    super();
    this.writable = true;
    this._writableState = { options: options || {} };
  }

  write() {
    warnNoDataFlow("write");
    return false;
  }

  end() {
    warnNoDataFlow("end");
    return this;
  }

  _write() {}
}

export class Duplex extends Readable {
  constructor(options) {
    super(options);
    this.writable = true;
  }

  write() {
    warnNoDataFlow("write");
    return false;
  }

  end() {
    warnNoDataFlow("end");
    return this;
  }
}

export class Transform extends Duplex {
  _transform() {}
}

export class PassThrough extends Transform {}
