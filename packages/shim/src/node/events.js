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

EventEmitter.prototype.setMaxListeners = function () {
  return this;
};

EventEmitter.prototype.getMaxListeners = function () {
  return 10;
};

EventEmitter.EventEmitter = EventEmitter;
