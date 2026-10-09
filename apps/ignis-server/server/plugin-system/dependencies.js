const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const installations = new Map();

function validateDependency(dependency) {
  if (
    !dependency ||
    !PACKAGE_NAME.test(dependency.name) ||
    !EXACT_VERSION.test(dependency.version) ||
    (dependency.installScripts !== undefined &&
      typeof dependency.installScripts !== "boolean")
  ) {
    throw Object.assign(
      new Error("Plugins must declare exact npm dependencies"),
      { code: "INVALID_PLUGIN_DEPENDENCY" },
    );
  }
}

function findNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    "/usr/share/nodejs/npm/bin/npm-cli.js",
  ];

  const cli = candidates.find(
    (file) => file && file.endsWith("npm-cli.js") && fs.existsSync(file),
  );

  if (!cli) {
    throw Object.assign(
      new Error("npm is required to install plugin dependencies"),
      { code: "NPM_NOT_FOUND" },
    );
  }

  return cli;
}

async function installPackage(directory, dependency) {
  // Only bundled plugin declarations reach this installer, never HTTP input.
  await execFileAsync(
    process.execPath,
    [
      findNpmCli(),
      "install",
      "--prefix",
      directory,
      "--global=false",
      "--workspaces=false",
      "--package-lock=true",
      "--omit=dev",
      `--ignore-scripts=${!dependency.installScripts}`,
      "--no-audit",
      "--no-fund",
    ],
    {
      timeout: 300000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
}

class DependencyManager {
  constructor(dataRoot, { install = installPackage, log = () => {} } = {}) {
    this.root = path.resolve(dataRoot, "plugin-dependencies");
    this.install = install;
    this.log = log;
  }

  directoryFor(dependency) {
    validateDependency(dependency);
    // Optional npm dependencies can contain native code without install scripts.
    const runtime = `${process.platform}-${process.arch}-${process.versions.modules}`;
    const policy = dependency.installScripts ? "scripts" : "no-scripts";
    return path.join(
      this.root,
      dependency.name,
      dependency.version,
      `${runtime}-${policy}`,
    );
  }

  resolveCached(dependency) {
    const directory = this.directoryFor(dependency);
    const packageDir = path.join(directory, "node_modules", dependency.name);

    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"),
      );
      const installed = JSON.parse(
        fs.readFileSync(path.join(directory, "installed.json"), "utf-8"),
      );

      if (
        pkg.version !== dependency.version ||
        installed.version !== pkg.version
      ) {
        return null;
      }

      return createRequire(path.join(directory, "package.json")).resolve(
        dependency.name,
      );
    } catch {
      return null;
    }
  }

  ensure(dependency) {
    const directory = this.directoryFor(dependency);

    // Share an install across plugins, vaults, and manager instances.
    if (installations.has(directory)) {
      return installations.get(directory);
    }

    const pending = this.installDependency(dependency, directory).finally(() =>
      installations.delete(directory),
    );
    installations.set(directory, pending);
    return pending;
  }

  async installDependency(dependency, directory) {
    const cached = this.resolveCached(dependency);

    if (cached) {
      return cached;
    }

    this.log(`Installing ${dependency.name}@${dependency.version}`);
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.rm(path.join(directory, "installed.json"), {
      force: true,
    });
    await fs.promises.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          private: true,
          dependencies: { [dependency.name]: dependency.version },
        },
        null,
        2,
      ),
    );

    try {
      await this.install(directory, dependency);
      const requireDependency = createRequire(
        path.join(directory, "package.json"),
      );
      const resolved = requireDependency.resolve(dependency.name);
      const pkg = JSON.parse(
        await fs.promises.readFile(
          path.join(directory, "node_modules", dependency.name, "package.json"),
          "utf-8",
        ),
      );

      if (pkg.version !== dependency.version) {
        throw new Error(`Unexpected version installed for ${dependency.name}`);
      }

      await fs.promises.writeFile(
        path.join(directory, "installed.json"),
        JSON.stringify({ version: pkg.version }),
      );
      this.log(`Installed ${dependency.name}@${dependency.version}`);
      return resolved;
    } catch (e) {
      this.log(`Failed to install ${dependency.name}: ${e.message}`);
      throw Object.assign(
        new Error(`Could not install ${dependency.name}`, { cause: e }),
        { code: "PLUGIN_DEPENDENCY_INSTALL_FAILED" },
      );
    }
  }

  async prepare(dependencies = []) {
    if (!Array.isArray(dependencies)) {
      throw Object.assign(new Error("Plugin dependencies must be an array"), {
        code: "INVALID_PLUGIN_DEPENDENCY",
      });
    }

    // Validate the complete declaration before starting any installation.
    const declared = new Set();

    for (const dependency of dependencies) {
      validateDependency(dependency);

      if (declared.has(dependency.name)) {
        throw Object.assign(new Error("Duplicate plugin dependency"), {
          code: "INVALID_PLUGIN_DEPENDENCY",
        });
      }

      declared.add(dependency.name);
    }

    const modules = new Map();

    for (const dependency of dependencies) {
      modules.set(dependency.name, await this.ensure(dependency));
    }

    function resolve(name) {
      if (!modules.has(name)) {
        throw new Error(`Undeclared plugin dependency: ${name}`);
      }

      return modules.get(name);
    }

    return { resolve, require: (name) => require(resolve(name)) };
  }
}

module.exports = { DependencyManager };
