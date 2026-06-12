import { EventEmitter } from "../node/events.js";

const DEFAULT_CHUNK_SIZE = 64 * 1024;

export function createReadStream(path, options, fsImpl) {
  return new ReadStream(path, options, fsImpl);
}

export function createWriteStream(path, options, fsImpl) {
  return new WriteStream(path, options, fsImpl);
}

class ReadStream extends EventEmitter {
  constructor(path, options, fsImpl) {
    super();
    this.path = path;
    this.options = options || {};
    this._fs = fsImpl;
    this.bytesRead = 0;
    this.readable = true;
    this._readableState = {};

    // Start reading on next tick so caller can attach listeners.
    setTimeout(() => this._read(), 0);
  }

  _read() {
    let data;

    try {
      const encoding = this.options.encoding;
      data = this._fs.readFileSync(this.path, encoding ? { encoding } : undefined);
    } catch (e) {
      this.emit("error", e);
      return;
    }

    const chunkSize = this.options.highWaterMark || DEFAULT_CHUNK_SIZE;

    if (typeof data === "string") {
      this._pushString(data, chunkSize);
    } else {
      this._pushBuffer(data, chunkSize);
    }
  }

  _pushString(data, chunkSize) {
    let offset = 0;

    while (offset < data.length) {
      const chunk = data.slice(offset, offset + chunkSize);
      offset += chunkSize;
      this.bytesRead += chunk.length;
      this.emit("data", chunk);
    }

    this.emit("end");
    this.emit("close");
  }

  _pushBuffer(data, chunkSize) {
    let offset = 0;

    while (offset < data.length) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunk = data.subarray(offset, end);
      offset = end;
      this.bytesRead += chunk.length;
      this.emit("data", chunk);
    }

    this.emit("end");
    this.emit("close");
  }

  pipe(destination) {
    this.on("data", (chunk) => destination.write(chunk));
    this.on("end", () => destination.end());
    return destination;
  }
}

class WriteStream extends EventEmitter {
  constructor(path, options, fsImpl) {
    super();
    this.path = path;
    this.options = options || {};
    this._fs = fsImpl;
    this.bytesWritten = 0;
    this.writable = true;
    this._chunks = [];
    this._encoding = this.options.encoding || "utf-8";
  }

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }

    const enc = encoding || this._encoding;

    if (typeof chunk === "string") {
      this._chunks.push(chunk);
      this.bytesWritten += new TextEncoder().encode(chunk).length;
    } else if (chunk instanceof Uint8Array || chunk instanceof ArrayBuffer) {
      const buf = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
      this._chunks.push(buf);
      this.bytesWritten += buf.length;
    } else if (Buffer.isBuffer && Buffer.isBuffer(chunk)) {
      const buf = new Uint8Array(chunk);
      this._chunks.push(buf);
      this.bytesWritten += buf.length;
    }

    if (callback) {
      callback();
    }

    return true;
  }

  end(chunk, encoding, callback) {
    if (chunk) {
      this.write(chunk, encoding);
    }

    try {
      if (this._chunks.length === 1) {
        const first = this._chunks[0];
        this._fs.writeFileSync(this.path, first, this._encoding);
      } else if (this._chunks.length > 1) {
        const totalLength = this._chunks.reduce((sum, c) => {
          return sum + (typeof c === "string" ? new TextEncoder().encode(c).length : c.length);
        }, 0);

        const merged = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of this._chunks) {
          if (typeof chunk === "string") {
            const encoded = new TextEncoder().encode(chunk);
            merged.set(encoded, offset);
            offset += encoded.length;
          } else {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
        }

        this._fs.writeFileSync(this.path, merged, "binary");
      }

      this.emit("finish");
      this.emit("close");
    } catch (e) {
      this.emit("error", e);
    }

    if (callback) {
      callback();
    }

    return this;
  }
}
