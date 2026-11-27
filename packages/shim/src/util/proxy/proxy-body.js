export const readAheadLimits = {
  eagerBytes: 1024 * 1024,
  unreadAfterMs: 2000,
  unreadBytes: 50 * 1024 * 1024,
  abandonedAfterMs: 5 * 60 * 1000,
};

async function readNonEmptyChunk(reader) {
  let chunk = await reader.read();

  while (!chunk.done && chunk.value.length === 0) {
    chunk = await reader.read();
  }

  return chunk;
}

export function proxiedBody(reader, firstBodyBytes, onConnectionFree) {
  const ahead = [];
  let aheadBytes = 0;
  let readAheadBytes = readAheadLimits.eagerBytes;
  let ended = false;
  let failure = null;
  let isReading = false;
  let pendingPull = null;
  let timer = null;
  let controller;

  function keep(chunk) {
    ahead.push(chunk);
    aheadBytes += chunk.length;
  }

  function deliver() {
    if (!pendingPull) {
      return;
    }

    if (ahead.length > 0) {
      const chunk = ahead.shift();
      aheadBytes -= chunk.length;
      controller.enqueue(chunk);
      watchForUnread();
    } else if (failure) {
      controller.error(failure);
    } else if (ended) {
      controller.close();
      controller.byobRequest?.respond(0); // end caller's buffer read.
    } else {
      return;
    }

    pendingPull();
    pendingPull = null;
  }

  function wantsMore() {
    const isPullWaiting = pendingPull && ahead.length === 0;

    return !ended && !failure && (isPullWaiting || aheadBytes < readAheadBytes);
  }

  async function readFromProxy() {
    if (isReading) {
      return;
    }

    isReading = true;

    try {
      while (wantsMore()) {
        const { done, value } = await readNonEmptyChunk(reader);

        if (done) {
          ended = true;
          clearTimeout(timer);
          onConnectionFree();
        } else {
          keep(value);
        }

        deliver();
      }
    } catch (e) {
      fail(e);
    }

    isReading = false;
  }

  function fail(error) {
    failure = error;
    ahead.length = 0;
    aheadBytes = 0;
    clearTimeout(timer);
    onConnectionFree();
    deliver();
  }

  function abandon() {
    reader.cancel().catch(() => {});
    fail(new TypeError("The response went unread and was dropped"));
  }

  function watchForUnread() {
    clearTimeout(timer);

    if (ended || failure) {
      return;
    }

    timer = setTimeout(() => {
      readAheadBytes = readAheadLimits.unreadBytes;
      timer = setTimeout(abandon, readAheadLimits.abandonedAfterMs);
      readFromProxy();
    }, readAheadLimits.unreadAfterMs);
  }

  return new ReadableStream({
    type: "bytes",

    start(streamController) {
      controller = streamController;

      if (firstBodyBytes.length > 0) {
        keep(firstBodyBytes);
      }

      reader.closed.catch(fail); // fail without waiting for the next read.
      watchForUnread();
      readFromProxy();
    },

    pull() {
      clearTimeout(timer);
      readAheadBytes = readAheadLimits.eagerBytes;

      return new Promise((resolve) => {
        pendingPull = resolve;
        deliver();
        readFromProxy();
      });
    },

    cancel(reason) {
      clearTimeout(timer);
      onConnectionFree();

      return reader.cancel(reason);
    },
  });
}
