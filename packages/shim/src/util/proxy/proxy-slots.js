export const slotLimits = {
  // http/1 supports only 6 connections. reserve two for ignis.
  maxOpenOnHttp1: 4,
};

let openRequests = 0;
const waiting = [];

function isMultiplexedOrigin() {
  const entries = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ];

  return entries.some(
    (entry) =>
      new URL(entry.name).origin === location.origin &&
      (entry.nextHopProtocol === "h2" || entry.nextHopProtocol === "h3"),
  );
}

function slot() {
  let released = false;

  return function release() {
    if (released) {
      return;
    }

    released = true;
    const next = waiting.shift();

    if (next) {
      next.start();
    } else {
      openRequests--;
    }
  };
}

export function takeProxySlot(signal) {
  if (isMultiplexedOrigin()) {
    return Promise.resolve(() => {});
  }

  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  if (openRequests < slotLimits.maxOpenOnHttp1) {
    openRequests++;

    return Promise.resolve(slot());
  }

  return new Promise((resolve, reject) => {
    function leaveQueue() {
      waiting.splice(waiting.indexOf(waiter), 1);
      reject(signal.reason);
    }

    const waiter = {
      start() {
        signal?.removeEventListener("abort", leaveQueue);
        resolve(slot());
      },
    };

    waiting.push(waiter);
    signal?.addEventListener("abort", leaveQueue, { once: true });
  });
}
