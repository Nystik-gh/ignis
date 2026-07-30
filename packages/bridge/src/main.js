import { Plugin, TFile, TFolder } from "obsidian";
import {
  showFilePicker,
  addFileMenuItems,
  addFolderMenuItems,
} from "./file-actions.js";
import {
  patchSettingsModal,
  unpatchSettingsModal,
} from "./settings/inject.js";
import * as pluginRegistry from "./plugin-registry.js";
import { initStatusBar } from "./status-bar.js";
import { initSaveNotice } from "./save-notice.js";
import { installLoadingGate } from "./loading-gate.js";
import { WorkspacePickerModal } from "./workspace-picker.js";
import { startDemoGuards, stopDemoGuards } from "./demo-guards.js";
import { initInsecureApiNotice } from "./insecure-api-notice.js";
import { initProxyBlockNotice } from "./proxy-block-notice.js";

class IgnisBridgePlugin extends Plugin {
  async onload() {
    if (!window.__ignis) {
      console.log("[ignis-bridge] Not running in Ignis - plugin is a no-op.");
      return;
    }

    console.log("[ignis-bridge] Plugin loaded");

    await pluginRegistry.refresh();
    patchSettingsModal(this);
    startDemoGuards();
    this._statusBarUnsub = initStatusBar(this);
    this._saveNoticeUnsub = initSaveNotice();
    this._loadingGateUnsub = installLoadingGate();
    this._insecureApiUnsub = initInsecureApiNotice();
    this._proxyBlockUnsub = initProxyBlockNotice(this.app);

    this.addRibbonIcon("upload", "Upload file", () => {
      showFilePicker(this.app);
    });

    this.addCommand({
      id: "open-workspace-in-new-tab",
      name: "Open workspace in new tab",
      callback: () => {
        new WorkspacePickerModal(this.app).open();
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile) {
          addFileMenuItems(menu, file);
        } else if (file instanceof TFolder) {
          addFolderMenuItems(menu, file, this.app);
        }
      }),
    );
  }

  onunload() {
    if (!window.__ignis) {
      return;
    }

    if (this._statusBarUnsub) {
      this._statusBarUnsub();
    }

    if (this._saveNoticeUnsub) {
      this._saveNoticeUnsub();
    }

    if (this._loadingGateUnsub) {
      this._loadingGateUnsub();
    }

    if (this._insecureApiUnsub) {
      this._insecureApiUnsub();
    }

    if (this._proxyBlockUnsub) {
      this._proxyBlockUnsub();
    }

    unpatchSettingsModal(this);
    stopDemoGuards();
    console.log("[ignis-bridge] Plugin unloaded");
  }
}

export default IgnisBridgePlugin;
