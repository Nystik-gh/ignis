import { describe, it, expect } from "vitest";
import { createFdOps } from "./fd.js";

function makeStubs(files = {}) {
  const meta = {
    has(p) {
      return p in files;
    },
    toStat(p) {
      if (!(p in files)) {
        return null;
      }

      return {
        size: files[p].length,
        isFile: () => true,
        isDirectory: () => false,
      };
    },
  };

  const content = {
    _store: {},
    get(p) {
      return this._store[p] ?? null;
    },
    set(p, data) {
      this._store[p] = data;
    },
  };

  const transport = {
    readFileSync(p) {
      return files[p] ?? null;
    },
  };

  // Pre-populate content cache so ensureData doesn't hit transport
  for (const [p, data] of Object.entries(files)) {
    content.set(p, data);
  }

  return { meta, content, transport };
}

function makeOps(files = {}) {
  const { meta, content, transport } = makeStubs(files);
  return createFdOps(meta, content, transport);
}

// -- openSync / closeSync lifecycle ------------------------------------

describe("fd openSync / closeSync lifecycle", () => {
  it("open returns an integer fd", () => {
    const ops = makeOps({ "a.md": new Uint8Array([1, 2, 3]) });
    const fd = ops.openSync("a.md", "r");
    expect(typeof fd).toBe("number");
    expect(Number.isInteger(fd)).toBe(true);
  });

  it("multiple opens return distinct fds", () => {
    const ops = makeOps({ "a.md": new Uint8Array([1]) });
    const fd1 = ops.openSync("a.md", "r");
    const fd2 = ops.openSync("a.md", "r");
    expect(fd1).not.toBe(fd2);
  });

  it("close removes the fd", () => {
    const ops = makeOps({ "a.md": new Uint8Array([1]) });
    const fd = ops.openSync("a.md", "r");
    ops.closeSync(fd);
    expect(() => ops.readSync(fd, new Uint8Array(1), 0, 1, 0)).toThrow(
      "EBADF",
    );
  });

  it("open throws ENOENT for missing path", () => {
    const ops = makeOps({});
    expect(() => ops.openSync("nope.md", "r")).toThrow("ENOENT");
  });

  it("accessing a closed fd throws EBADF", () => {
    const ops = makeOps({ "a.md": new Uint8Array([1]) });
    const fd = ops.openSync("a.md", "r");
    ops.closeSync(fd);
    expect(() => ops.fstatSync(fd)).toThrow("EBADF");
  });
});

// -- readSync ----------------------------------------------------------

describe("fd readSync", () => {
  const data = new Uint8Array([10, 20, 30, 40, 50]);

  function openData() {
    const ops = makeOps({ "f.bin": data });
    const fd = ops.openSync("f.bin", "r");
    return { ops, fd };
  }

  it("read from position 0, full length", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(5);
    const n = ops.readSync(fd, buf, 0, 5, 0);
    expect(n).toBe(5);
    expect(buf).toEqual(data);
  });

  it("read from mid-file position", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(3);
    const n = ops.readSync(fd, buf, 0, 3, 2);
    expect(n).toBe(3);
    expect(buf).toEqual(new Uint8Array([30, 40, 50]));
  });

  it("read with length exceeding remaining data", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(10);
    const n = ops.readSync(fd, buf, 0, 10, 3);
    expect(n).toBe(2);
    expect(buf[0]).toBe(40);
    expect(buf[1]).toBe(50);
  });

  it("read at position === data.length returns 0 bytes", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(5);
    const n = ops.readSync(fd, buf, 0, 5, 5);
    expect(n).toBe(0);
  });

  it("read at position > data.length returns 0 bytes", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(5);
    const n = ops.readSync(fd, buf, 0, 5, 100);
    expect(n).toBe(0);
  });

  it("read with offset > 0 places data at correct position", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(6);
    buf.fill(0);
    const n = ops.readSync(fd, buf, 3, 2, 0);
    expect(n).toBe(2);
    expect(buf).toEqual(new Uint8Array([0, 0, 0, 10, 20, 0]));
  });

  it("target buffer is actually modified", () => {
    const { ops, fd } = openData();
    const buf = new Uint8Array(3);
    buf.fill(255);
    ops.readSync(fd, buf, 0, 2, 0);
    expect(buf[0]).toBe(10);
    expect(buf[1]).toBe(20);
    expect(buf[2]).toBe(255); // untouched
  });
});

// -- fstatSync ---------------------------------------------------------

describe("fd fstatSync", () => {
  it("returns metadata from cache when available", () => {
    const ops = makeOps({ "a.md": new Uint8Array([1, 2, 3]) });
    const fd = ops.openSync("a.md", "r");
    const stat = ops.fstatSync(fd);
    expect(stat.size).toBe(3);
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
  });

  it("falls back to buffer length when metadata is missing", () => {
    const { meta, content, transport } = makeStubs({
      "a.md": new Uint8Array([1, 2, 3, 4]),
    });

    // Override toStat to return null, simulating missing metadata
    meta.toStat = () => null;

    const ops = createFdOps(meta, content, transport);
    const fd = ops.openSync("a.md", "r");
    const stat = ops.fstatSync(fd);
    expect(stat.size).toBe(4);
    expect(stat.isFile()).toBe(true);
  });
});

// -- Async wrappers ----------------------------------------------------

describe("fd async wrappers", () => {
  it("open() calls callback asynchronously", async () => {
    const ops = makeOps({ "a.md": new Uint8Array([1]) });
    let called = false;

    const promise = new Promise((resolve, reject) => {
      ops.open("a.md", "r", (err, fd) => {
        called = true;

        if (err) {
          reject(err);
        } else {
          resolve(fd);
        }
      });
    });

    // Callback should not have fired synchronously
    expect(called).toBe(false);
    const fd = await promise;
    expect(typeof fd).toBe("number");
  });

  it("open() error path calls cb(err)", async () => {
    const ops = makeOps({});

    const err = await new Promise((resolve) => {
      ops.open("nope.md", "r", (e) => resolve(e));
    });

    expect(err).toBeTruthy();
    expect(err.code).toBe("ENOENT");
  });

  it("read() delivers results via callback", async () => {
    const ops = makeOps({ "a.md": new Uint8Array([10, 20]) });

    const fd = await new Promise((resolve, reject) => {
      ops.open("a.md", "r", (err, fd) => (err ? reject(err) : resolve(fd)));
    });

    const buf = new Uint8Array(2);

    const bytesRead = await new Promise((resolve, reject) => {
      ops.read(fd, buf, 0, 2, 0, (err, n) =>
        err ? reject(err) : resolve(n),
      );
    });

    expect(bytesRead).toBe(2);
    expect(buf).toEqual(new Uint8Array([10, 20]));
  });

  it("close() calls callback asynchronously", async () => {
    const ops = makeOps({ "a.md": new Uint8Array([1]) });
    const fd = ops.openSync("a.md", "r");

    const result = await new Promise((resolve) => {
      ops.close(fd, (err) => resolve(err));
    });

    expect(result).toBe(null);
  });

  it("fstat() calls callback asynchronously", async () => {
    const ops = makeOps({ "a.md": new Uint8Array([1, 2, 3]) });
    const fd = ops.openSync("a.md", "r");

    const stat = await new Promise((resolve, reject) => {
      ops.fstat(fd, (err, s) => (err ? reject(err) : resolve(s)));
    });

    expect(stat.size).toBe(3);
  });

  it("fstat() error path calls cb(err) for bad fd", async () => {
    const ops = makeOps({});

    const err = await new Promise((resolve) => {
      ops.fstat(99999, (e) => resolve(e));
    });

    expect(err).toBeTruthy();
    expect(err.code).toBe("EBADF");
  });
});
