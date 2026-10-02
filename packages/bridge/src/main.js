import { Plugin, TFile, TFolder } from "obsidian";
import {
  showFilePicker,
  addFileMenuItems,
  addFolderMenuItems,
} from "./file-actions.js";
import {
  patchSettingsModal,
  unpatchSettingsModal,
  refreshIgnisSettings,
  reconcilePluginTabs,
} from "./settings/inject.js";
import { watchPluginToggles } from "./settings/plugin-list.js";
import * as pluginRegistry from "./plugin-registry.js";
import { initStatusBar } from "./status-bar.js";
import { initSaveNotice } from "./notices/save-notice.js";
import { installLoadingGate } from "./loading-gate.js";
import { registerCommands } from "./commands/index.js";
import { startDemoGuards, stopDemoGuards } from "./demo-guards.js";
import { initInsecureApiNotice } from "./notices/insecure-api-notice.js";
import { initProxyBlockNotice } from "./notices/proxy-block-notice.js";
import { initWriteGiveupNotice } from "./notices/write-giveup-notice.js";
import { initImageRetry } from "./image-retry.js";
import { installReadingLock } from "./reading-lock.js";

class IgnisBridgePlugin extends Plugin {
  async onload() {
    if (!window.__ignis) {
      console.log("[ignis-bridge] Not running in Ignis - plugin is a no-op.");
      return;
    }

    console.log("[ignis-bridge] Plugin loaded");

    await pluginRegistry.refresh();
    patchSettingsModal(this);
    refreshIgnisSettings();
    this._pluginTogglesUnsub = watchPluginToggles();

    this.registerDomEvent(window, "ignis:virtual-plugin-loaded", () => {
      reconcilePluginTabs(this.app.setting);
    });
    startDemoGuards();
    this._statusBarUnsub = initStatusBar(this);
    this._saveNoticeUnsub = initSaveNotice();
    this._loadingGateUnsub = installLoadingGate();
    this._insecureApiUnsub = initInsecureApiNotice();
    this._proxyBlockUnsub = initProxyBlockNotice(this.app);
    this._imageRetryUnsub = initImageRetry();

    const flags = window.__ignis.flags || {};

    if (!flags.suppressWriteFailures) {
      this._writeGiveupUnsub = initWriteGiveupNotice();
    }

    if (flags.forceReadingView) {
      installReadingLock(this);
    }

    this.addRibbonIcon("upload", "Upload file", () => {
      showFilePicker(this.app);
    });

    registerCommands(this);

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

    if (this._writeGiveupUnsub) {
      this._writeGiveupUnsub();
    }

    if (this._imageRetryUnsub) {
      this._imageRetryUnsub();
    }

    if (this._pluginTogglesUnsub) {
      this._pluginTogglesUnsub();
    }

    unpatchSettingsModal(this);
    stopDemoGuards();
    console.log("[ignis-bridge] Plugin unloaded");
  }
}

export default IgnisBridgePlugin;
