export class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }

    this._events[event].push(listener);

    return this;
  }

  once(event, listener) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };

    wrapped._original = listener;
    return this.on(event, wrapped);
  }

  emit(event, ...args) {
    const listeners = this._events[event];

    if (!listeners || listeners.length === 0) {
      return false;
    }

    for (const fn of [...listeners]) {
      fn.apply(this, args);
    }

    return true;
  }

  removeListener(event, listener) {
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
  }

  off(event, listener) {
    return this.removeListener(event, listener);
  }

  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }

    return this;
  }

  listeners(event) {
    return (this._events[event] || []).slice();
  }

  listenerCount(event) {
    return (this._events[event] || []).length;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  prependListener(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }

    this._events[event].unshift(listener);

    return this;
  }

  eventNames() {
    return Object.keys(this._events);
  }

  setMaxListeners() {
    return this;
  }

  getMaxListeners() {
    return 10;
  }
}

export default EventEmitter;
