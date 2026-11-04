function notAvailable(name) {
  return function () {
    throw new Error(`tty.${name}() is not available in the web version.`);
  };
}

export function isatty() {
  return false;
}

export const ReadStream = notAvailable("ReadStream");
export const WriteStream = notAvailable("WriteStream");
