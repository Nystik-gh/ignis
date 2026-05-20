import {
  showMessageDialog,
  showConfirmDialog,
  showPromptDialog,
} from "../../ui-registry.js";
import { inputCacheSet, inputCacheDelete } from "../../fs/input-cache.js";

const IMPORTS_DIR = ".obsidian/imports";
const STAGED_TTL_MS = 120_000; // 2 minutes

let staged = { paths: [], fingerprint: null, timestamp: 0 };

function getCallerFingerprint() {
  const stack = new Error().stack || "";
  const frames = stack
    .split("\n")
    .filter((l) => !l.includes("shim-loader") && !l.includes("dialog.js"));
  return frames.slice(0, 3).join("|");
}

function clearStagedFiles() {
  if (staged.paths.length === 0) return;

  console.log("[shim:dialog] Clearing expired staged files");

  for (const p of staged.paths) {
    inputCacheDelete(p.replace(/^\//, ""));
  }

  staged = { paths: [], fingerprint: null, timestamp: 0 };
}

function buildAcceptString(filters) {
  if (!filters || filters.length === 0) {
    return "";
  }

  const extensions = filters.flatMap((f) => f.extensions || []);

  if (extensions.includes("*")) {
    return "";
  }

  return extensions.map((ext) => "." + ext).join(",");
}

function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.style.display = "none";

    if (accept) {
      input.accept = accept;
    }

    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });

    // User closed the picker without selecting
    input.addEventListener("cancel", () => {
      input.remove();
      resolve([]);
    });

    document.body.appendChild(input);
    input.click();
  });
}

async function cacheToImports(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const targetPath = IMPORTS_DIR + "/" + file.name;

  inputCacheSet(targetPath, bytes);

  return "/" + targetPath;
}

async function startWorkaroundFlow(options, fingerprint) {
  const properties = options?.properties || [];
  const multiple = properties.includes("multiSelections");
  const accept = buildAcceptString(options?.filters);

  const files = await pickFiles(accept, multiple);

  if (files.length === 0) {
    return;
  }

  const paths = [];

  for (const file of files) {
    const vaultPath = await cacheToImports(file);
    paths.push(vaultPath);
  }

  staged = { paths, fingerprint, timestamp: Date.now() };

  const names = paths.map((p) => p.split("/").pop()).join(", ");

  console.log("[shim:dialog] Files staged for caller:", fingerprint);

  await showMessageDialog(
    "Files Ready",
    `Staged: ${names}\n\nPlease retry the action that brought you here. ` +
      "The files will be provided automatically.",
  );
}

export const dialogShim = {
  async showOpenDialog(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }

    const properties = options?.properties || [];
    const multiple = properties.includes("multiSelections");
    const accept = buildAcceptString(options?.filters);

    console.log("[shim:dialog] showOpenDialog  -  opening browser file picker");

    const files = await pickFiles(accept, multiple);

    if (files.length === 0) {
      return { canceled: true, filePaths: [] };
    }

    const filePaths = [];

    for (const file of files) {
      const vaultPath = await cacheToImports(file);
      filePaths.push(vaultPath);
    }

    console.log("[shim:dialog] showOpenDialog  -  cached:", filePaths);
    return { canceled: false, filePaths };
  },

  showOpenDialogSync(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }

    // If files were staged from a previous workaround, validate and return them
    if (staged.paths.length > 0) {
      const elapsed = Date.now() - staged.timestamp;
      const fingerprint = getCallerFingerprint();
      const fingerprintMatch = fingerprint === staged.fingerprint;
      const expired = elapsed > STAGED_TTL_MS;

      if (expired) {
        console.warn("[shim:dialog] Staged files expired after", elapsed, "ms");
        clearStagedFiles();
      } else if (!fingerprintMatch) {
        console.warn(
          "[shim:dialog] Staged files caller mismatch  -  ignoring",
          "\n  expected:",
          staged.fingerprint,
          "\n  got:",
          fingerprint,
        );
      } else {
        const paths = staged.paths;
        staged = { paths: [], fingerprint: null, timestamp: 0 };
        console.log(
          "[shim:dialog] showOpenDialogSync  -  returning staged files:",
          paths,
        );
        return paths;
      }
    }

    console.warn(
      "[shim:dialog] showOpenDialogSync requires workaround in browser context",
    );

    // Capture fingerprint here where the plugin's call stack is still visible
    const callerFingerprint = getCallerFingerprint();

    // Fire-and-forget: show warning, then optionally start workaround flow
    showConfirmDialog(
      "Feature Not Available",
      "This action requires a native file picker which is not available in the browser.",
      "A workaround is available: select your files first, then retry the action. " +
        "They will be provided automatically.\n\n" +
        "Note: individual files must be under 200 MB.",
      "Select Files",
    ).then((confirmed) => {
      if (confirmed) {
        startWorkaroundFlow(options, callerFingerprint);
      }
    });

    return undefined;
  },

  async showSaveDialog(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }

    const defaultName =
      options?.defaultPath?.split(/[\/\\]/).pop() || "download";
    const name = await showPromptDialog(
      "Save File",
      "Save as:",
      "filename",
      defaultName,
      "Save",
    );

    if (!name) {
      return { canceled: true, filePath: undefined };
    }

    return { canceled: false, filePath: "/downloads/" + name };
  },

  async showMessageBox(browserWindow, options) {
    if (typeof browserWindow === "object" && !options) {
      options = browserWindow;
    }

    console.log("[shim:dialog] showMessageBox:", options);

    const message = options.message || "";
    const detail = options.detail || "";
    const buttons = options.buttons || ["OK"];
    const fullMessage = message + (detail ? "\n\n" + detail : "");

    if (buttons.length <= 1) {
      await showMessageDialog(options.title || "Message", fullMessage);
      return { response: 0, checkboxChecked: false };
    }

    const result = await showConfirmDialog(
      options.title || "Confirm",
      message,
      detail,
      buttons[0],
    );

    return {
      response: result ? 0 : 1,
      checkboxChecked: false,
    };
  },

  showErrorBox(title, content) {
    console.error("[shim:dialog] Error:", title, content);
    showMessageDialog(title, content);
  },
};
