// Shim for Node's `util` module.
// Implements the most commonly used functions; stubs the rest.

function promisify(fn) {
  if (typeof fn !== "function") {
    throw new TypeError('The "original" argument must be of type Function');
  }

  // If the function already has a custom promisified version, use it.
  if (fn[promisify.custom]) {
    return fn[promisify.custom];
  }

  function promisified(...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, ...results) => {
        if (err) {
          reject(err);
        } else if (results.length <= 1) {
          resolve(results[0]);
        } else {
          resolve(results);
        }
      });
    });
  }

  return promisified;
}

promisify.custom = Symbol.for("nodejs.util.promisify.custom");

function callbackify(fn) {
  if (typeof fn !== "function") {
    throw new TypeError('The "original" argument must be of type Function');
  }

  function callbackified(...args) {
    const callback = args.pop();

    fn.apply(this, args).then(
      (result) => callback(null, result),
      (err) => callback(err),
    );
  }

  return callbackified;
}

function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

function deprecate(fn, msg) {
  let warned = false;

  function deprecated(...args) {
    if (!warned) {
      console.warn("[ignis:util] DeprecationWarning:", msg);
      warned = true;
    }

    return fn.apply(this, args);
  }

  return deprecated;
}

function inspect(obj, opts) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function format(fmt, ...args) {
  if (typeof fmt !== "string") {
    return [fmt, ...args].map(String).join(" ");
  }

  let i = 0;

  const result = fmt.replace(/%[sdjifoO%]/g, (match) => {
    if (match === "%%") {
      return "%";
    }

    if (i >= args.length) {
      return match;
    }

    const arg = args[i++];

    switch (match) {
      case "%s":
        return String(arg);
      case "%d":
      case "%i":
        return parseInt(arg, 10).toString();
      case "%f":
        return parseFloat(arg).toString();
      case "%j":
        try {
          return JSON.stringify(arg);
        } catch {
          return "[Circular]";
        }
      case "%o":
      case "%O":
        return inspect(arg);
      default:
        return match;
    }
  });

  // Append remaining args.
  const remaining = args.slice(i);

  if (remaining.length > 0) {
    return result + " " + remaining.map(String).join(" ");
  }

  return result;
}

function debuglog(section) {
  return function () {};
}

function isDeepStrictEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const types = {
  isArray: Array.isArray,
  isDate: (v) => v instanceof Date,
  isRegExp: (v) => v instanceof RegExp,
  isAsyncFunction: (v) => typeof v === "function" && v.constructor.name === "AsyncFunction",
  isPromise: (v) => v instanceof Promise,
  isGeneratorFunction: (v) => typeof v === "function" && v.constructor.name === "GeneratorFunction",
  isArrayBuffer: (v) => v instanceof ArrayBuffer,
  isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isMap: (v) => v instanceof Map,
  isSet: (v) => v instanceof Set,
  isWeakMap: (v) => v instanceof WeakMap,
  isWeakSet: (v) => v instanceof WeakSet,
};

module.exports = {
  promisify,
  callbackify,
  inherits,
  deprecate,
  inspect,
  format,
  debuglog,
  isDeepStrictEqual,
  types,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
};
