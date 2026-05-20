export const processShim = {
  platform: "linux",
  versions: {
    electron: "28.2.3",
    node: "18.18.0",
    chrome: "120.0.0.0",
  },
  env: {},
  cwd: () => "/",
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  argv: [],
  type: "renderer",
  resourcesPath: "/",
  stdout: { write: (s) => console.log(s) },
  stderr: { write: (s) => console.error(s) },
  on: () => {},
  once: () => {},
  removeListener: () => {},
};
