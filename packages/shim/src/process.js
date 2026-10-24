function nowNanoseconds() {
  return Math.floor(performance.now() * 1e6);
}

function hrtime(previous) {
  let elapsed = nowNanoseconds();

  if (previous) {
    elapsed -= previous[0] * 1e9 + previous[1];
  }

  return [Math.floor(elapsed / 1e9), elapsed % 1e9];
}

hrtime.bigint = function () {
  return BigInt(nowNanoseconds());
};

export const processShim = {
  platform: "linux",
  version: "v24.21.0",
  versions: {
    electron: "43.7.5",
    node: "24.21.0",
    chrome: "150.0.7871.250",
  },
  env: {},
  cwd: () => "/",
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  hrtime,
  argv: [],
  type: "renderer",
  resourcesPath: "/",
  stdout: { write: (s) => console.log(s) },
  stderr: { write: (s) => console.error(s) },
  on: () => processShim,
  once: () => processShim,
  addListener: () => processShim,
  removeListener: () => processShim,
};
