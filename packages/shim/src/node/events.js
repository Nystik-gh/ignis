export function EventEmitter() {
  this._events = {};
}

EventEmitter.prototype.on = function (event, listener) {
  if (!this._events[event]) {
    this._events[event] = [];
  }

  this._events[event].push(listener);

  return this;
};

EventEmitter.prototype.once = function (event, listener) {
  const wrapped = (...args) => {
    this.removeListener(event, wrapped);
    listener.apply(this, args);
  };

  wrapped._original = listener;
  return this.on(event, wrapped);
};

EventEmitter.prototype.emit = function (event, ...args) {
  const listeners = this._events[event];

  if (!listeners || listeners.length === 0) {
    return false;
  }

  // Iterate a snapshot: a once-listener removes itself from this array during emit, which would corrupt a live iteration.
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const fn of [...listeners]) {
    fn.apply(this, args);
  }

  return true;
};

EventEmitter.prototype.removeListener = function (event, listener) {
  const arr = this._events[event];
  if (!arr) {
    return this;
  }

  const idx = arr.findIndex(
    (fn) => fn === listener || fn._original === listener,
  );

  if (idx >= 0) {
    arr.splice(idx, 1);
  }

  return this;
};

EventEmitter.prototype.off = function (event, listener) {
  return this.removeListener(event, listener);
};

EventEmitter.prototype.removeAllListeners = function (event) {
  if (event) {
    delete this._events[event];
  } else {
    this._events = {};
  }

  return this;
};

EventEmitter.prototype.listeners = function (event) {
  return (this._events[event] || []).slice();
};

EventEmitter.prototype.listenerCount = function (event) {
  return (this._events[event] || []).length;
};

EventEmitter.prototype.addListener = function (event, listener) {
  return this.on(event, listener);
};

EventEmitter.prototype.prependListener = function (event, listener) {
  if (!this._events[event]) {
    this._events[event] = [];
  }

  this._events[event].unshift(listener);

  return this;
};

EventEmitter.prototype.eventNames = function () {
  return Object.keys(this._events);
};

EventEmitter.prototype.setMaxListeners = function (n) {
  this._maxListeners = n;

  return this;
};

EventEmitter.prototype.getMaxListeners = function () {
  return this._maxListeners ?? EventEmitter.defaultMaxListeners;
};

EventEmitter.EventEmitter = EventEmitter;

EventEmitter.defaultMaxListeners = 10;

EventEmitter.setMaxListeners = function (
  n = EventEmitter.defaultMaxListeners,
  ...targets
) {
  if (targets.length === 0) {
    EventEmitter.defaultMaxListeners = n;
    return;
  }

  for (const target of targets) {
    if (typeof target.setMaxListeners === "function") {
      target.setMaxListeners(n);
    }
  }
};

EventEmitter.once = function (emitter, name, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }

    const isEmitter = typeof emitter.on === "function";

    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };

    function cleanup() {
      if (isEmitter) {
        emitter.removeListener(name, onEvent);
        emitter.removeListener("error", onError);
      } else {
        emitter.removeEventListener(name, onEvent);
      }

      signal?.removeEventListener("abort", onAbort);
    }

    if (isEmitter) {
      emitter.once(name, onEvent);
      emitter.once("error", onError);
    } else {
      emitter.addEventListener(name, onEvent, { once: true });
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

function abortError(signal) {
  const err = new Error("The operation was aborted", { cause: signal.reason });

  err.name = "AbortError";
  err.code = "ABORT_ERR";

  return err;
}
