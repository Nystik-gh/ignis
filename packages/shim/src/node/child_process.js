function notAvailable(name) {
  return function () {
    throw new Error(
      `child_process.${name}() is not available in the web version.`,
    );
  };
}

export const exec = notAvailable("exec");
export const execSync = notAvailable("execSync");
export const spawn = notAvailable("spawn");
export const fork = notAvailable("fork");
export const execFile = notAvailable("execFile");
export const execFileSync = notAvailable("execFileSync");
export const spawnSync = notAvailable("spawnSync");
