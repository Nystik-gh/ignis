const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const headlessSyncDir = path.join(
  __dirname,
  "apps",
  "ignis-server",
  "server",
  "plugins",
  "headless-sync",
  "obsidian",
);

const gitBackupDir = path.join(
  __dirname,
  "apps",
  "ignis-server",
  "server",
  "plugins",
  "git-backup",
  "obsidian",
);

// Compute version info once and share across per-package builds.
const { version: semver } = require("./package.json");
const build = process.env.IGNIS_BUILD || Date.now().toString(36).slice(-7);
const version = `${semver}+${build}`;

const buildInfoPath = path.join(
  __dirname,
  "apps",
  "ignis-server",
  "server",
  "build-info.json",
);

fs.writeFileSync(
  buildInfoPath,
  JSON.stringify({ semver, build, version }, null, 2),
);

// Used by packages.
process.env.IGNIS_BUILD_RESOLVED = build;

Promise.all([
  // Build shim-loader.js (delegated to packages/shim)
  require("./packages/shim/build.js"),

  // Build ignis-ui.js (delegated to packages/ui)
  require("./packages/ui/build.js"),

  // Build headless-sync bundled plugin
  esbuild
    .build({
      entryPoints: [path.join(headlessSyncDir, "src", "main.js")],
      bundle: true,
      outfile: path.join(headlessSyncDir, "dist", "ignis-headless-sync.js"),
      format: "cjs",
      platform: "browser",
      target: ["chrome90"],
      external: ["obsidian", "fs"],
      logLevel: "info",
    })
    .then(() => {
      fs.copyFileSync(
        path.join(headlessSyncDir, "styles.css"),
        path.join(headlessSyncDir, "dist", "ignis-headless-sync.css"),
      );
    }),

  // Build git-backup bundled plugin
  esbuild
    .build({
      entryPoints: [path.join(gitBackupDir, "src", "main.js")],
      bundle: true,
      outfile: path.join(gitBackupDir, "dist", "ignis-git-backup.js"),
      format: "cjs",
      platform: "browser",
      target: ["chrome90"],
      external: ["obsidian"],
      logLevel: "info",
    })
    .then(() => {
      fs.copyFileSync(
        path.join(gitBackupDir, "styles.css"),
        path.join(gitBackupDir, "dist", "ignis-git-backup.css"),
      );
    }),
]).catch(() => process.exit(1));
