export function codedError(message, code) {
  const error = new Error(message);
  error.code = code;

  return error;
}

export function abortError() {
  const error = codedError("The operation was aborted", "ABORT_ERR");
  error.name = "AbortError";

  return error;
}

export function emitError(emitter, error) {
  if (!emitter.emit("error", error)) {
    console.error(error);
  }
}
