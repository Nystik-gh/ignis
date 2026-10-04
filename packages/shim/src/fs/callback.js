import { checkTimes } from "./utimes.js";

const CALLBACK_METHODS = [
  "stat",
  "lstat",
  "readdir",
  "readFile",
  "writeFile",
  "appendFile",
  "unlink",
  "rename",
  "mkdir",
  "rmdir",
  "rm",
  "copyFile",
  "access",
  "utimes",
  "lutimes",
  "chmod",
];

export function createFsCallbacks(fsPromises) {
  const callbacks = {};

  for (const name of CALLBACK_METHODS) {
    callbacks[name] = function (...args) {
      const callback = args.pop();

      // throw synchronously on an invalid time
      if (name === "utimes" || name === "lutimes") {
        checkTimes(args[1], args[2]);
      }

      fsPromises[name](...args).then(
        (result) => callback(null, result),
        (err) => callback(err),
      );
    };
  }

  return callbacks;
}
