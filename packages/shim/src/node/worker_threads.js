// Shim for Node's `worker_threads` module.

function notAvailable(name) {
  return function () {
    throw new Error(
      `worker_threads.${name}() is not available in the web version.`,
    );
  };
}

export const Worker = notAvailable("Worker");
export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;
