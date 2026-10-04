import { resolvePathInfo } from "./transforms.js";
import { markSentOp } from "./echo-guard.js";
import { enqueue, flushPending, hasPending } from "./write-coalescer.js";
import { attachFollowUp } from "./write-durability.js";

function invalidTime(name) {
  const e = new TypeError(
    `The "${name}" argument must be a Date or a time in seconds`,
  );

  e.code = "ERR_INVALID_ARG_TYPE";

  return e;
}

function isDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]";
}

function toMs(time, name) {
  if (typeof time === "string" && Number.isFinite(Number(time))) {
    return Number(time) * 1000;
  }

  if (Number.isFinite(time)) {
    return time < 0 ? Date.now() : time * 1000;
  }

  if (isDate(time) && !Number.isNaN(time.getTime())) {
    return time.getTime();
  }

  throw invalidTime(name);
}

export function checkTimes(atime, mtime) {
  toMs(atime, "atime");
  toMs(mtime, "mtime");
}

export function createUtimes(metadataCache, transport) {
  function adoptReply(resolved, reply) {
    const meta = metadataCache.get(resolved);

    if (!reply || reply.type !== "file" || !meta || meta.type !== "file") {
      return;
    }

    meta.size = reply.size;
    meta.mtime = reply.mtime;
    meta.ctime = reply.ctime;
    metadataCache.set(resolved, meta);
  }

  return function commitUtimes(path, atime, mtime) {
    const atimeMs = toMs(atime, "atime");
    const mtimeMs = toMs(mtime, "mtime");
    const { resolved, redirected } = resolvePathInfo(path);
    const meta = metadataCache.get(resolved);

    if (!meta && !redirected) {
      const e = new Error(`ENOENT: no such file or directory, utime '${path}'`);

      e.code = "ENOENT";
      throw e;
    }

    if (meta) {
      meta.mtime = mtimeMs;
      metadataCache.set(resolved, meta);
    }

    const send = () => {
      markSentOp(resolved);

      return transport
        .utimes(resolved, atimeMs, mtimeMs)
        .then((reply) => adoptReply(resolved, reply))
        .catch((e) => {
          console.error("[shim:fs] utimes failed:", resolved, e);
        });
    };

    if (hasPending(resolved)) {
      flushPending(resolved);
    }

    return enqueue(resolved, () => {
      const attached = attachFollowUp(resolved, send);

      if (!attached) {
        return send();
      }
    });
  };
}
