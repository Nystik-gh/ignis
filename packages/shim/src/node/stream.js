import { EventEmitter } from "./events.js";

export class Stream extends EventEmitter {
  pipe(destination, options) {
    const end = !options || options.end !== false;

    this.on("data", (chunk) => {
      const canContinue = destination.write(chunk);
      if (!canContinue) {
        this.pause();
        destination.once("drain", () => this.resume());
      }
    });

    if (end) {
      this.on("end", () => destination.end());
    }

    this.on("error", (err) => destination.emit("error", err));

    return destination;
  }
}

export class Readable extends Stream {
  constructor(options) {
    super();
    this.readable = true;
    this._readableState = { options: options || {} };
    this._paused = false;
    this._buffer = [];
    this._ended = false;
  }

  read() {
    if (this._buffer.length > 0) {
      return this._buffer.shift();
    }
    return null;
  }

  push(chunk) {
    if (chunk === null) {
      this._ended = true;
      this.emit("end");
      return false;
    }

    this._buffer.push(chunk);

    if (!this._paused) {
      this._flush();
    }

    return !this._paused;
  }

  _flush() {
    while (this._buffer.length > 0 && !this._paused) {
      const chunk = this._buffer.shift();
      this.emit("data", chunk);
    }
  }

  pause() {
    this._paused = true;
    return this;
  }

  resume() {
    this._paused = false;
    this._flush();
    if (this._ended && this._buffer.length === 0) {
      this.emit("end");
    }
    return this;
  }

  _read() {}
}

export class Writable extends Stream {
  constructor(options) {
    super();
    this.writable = true;
    this._writableState = { options: options || {} };
    this._chunks = [];
    this._finalCalled = false;
  }

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    this._chunks.push(chunk);
    this.emit("drain");

    if (callback) {
      callback();
    }

    return true;
  }

  end(chunk, encoding, callback) {
    if (chunk) {
      this.write(chunk, encoding);
    }

    if (!this._finalCalled) {
      this._finalCalled = true;
      this.emit("finish");
    }

    if (callback) {
      callback();
    }

    return this;
  }

  _write() {}
}

export class Duplex extends Readable {
  constructor(options) {
    super(options);
    this.writable = true;
    this._chunks = [];
    this._finalCalled = false;
  }

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    this._chunks.push(chunk);
    this.emit("drain");

    if (callback) {
      callback();
    }

    return true;
  }

  end(chunk, encoding, callback) {
    if (chunk) {
      this.write(chunk, encoding);
    }

    if (!this._finalCalled) {
      this._finalCalled = true;
      this.emit("finish");
    }

    if (callback) {
      callback();
    }

    return this;
  }
}

export class Transform extends Duplex {
  _transform() {}
}

export class PassThrough extends Transform {
  _transform(chunk, encoding, callback) {
    this.push(chunk);
    if (callback) callback();
  }
}
