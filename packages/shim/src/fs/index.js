import { MetadataCache } from "./metadata-cache.js";
import { ContentCache } from "./content-cache.js";
import { transport } from "./transport.js";
import { createFsPromises } from "./promises.js";
import { createFsSync } from "./sync.js";
import { createFsWatch } from "./watch.js";
import { createWatcherClient } from "./watcher-client.js";
import { createFdOps } from "./fd.js";
import { createFsCallbacks } from "./callback.js";
import { realpath, realpathSync } from "./realpath.js";
import { constants } from "./constants.js";
import { registerReadTransform, removeReadTransform, resolvePath } from "./transforms.js";
import { wsClient } from "../ws-client.js";

const metadataCache = new MetadataCache();
const contentCache = new ContentCache();

const fsPromises = createFsPromises(metadataCache, contentCache, transport);
const fsSync = createFsSync(metadataCache, contentCache, transport);
const fsWatch = createFsWatch(transport);
const watcherClient = createWatcherClient(
  metadataCache,
  contentCache,
  fsWatch,
  wsClient,
  transport,
);
const fdOps = createFdOps(metadataCache, contentCache, transport);
const fsCallbacks = createFsCallbacks(fsPromises);

export const fsShim = {
  promises: fsPromises,

  ...fsCallbacks,

  existsSync: fsSync.existsSync,
  readFileSync: fsSync.readFileSync,
  writeFileSync: fsSync.writeFileSync,
  unlinkSync: fsSync.unlinkSync,
  accessSync: fsSync.accessSync,
  statSync: fsSync.statSync,
  readdirSync: fsSync.readdirSync,
  lstatSync: fsSync.lstatSync,
  mkdirSync: fsSync.mkdirSync,
  rmdirSync: fsSync.rmdirSync,
  rmSync: fsSync.rmSync,
  renameSync: fsSync.renameSync,
  copyFileSync: fsSync.copyFileSync,
  appendFileSync: fsSync.appendFileSync,
  utimesSync: fsSync.utimesSync,
  chmodSync: fsSync.chmodSync,

  realpath,
  realpathSync,

  open: fdOps.open,
  openSync: fdOps.openSync,
  read: fdOps.read,
  readSync: fdOps.readSync,
  close: fdOps.close,
  closeSync: fdOps.closeSync,
  fstat: fdOps.fstat,
  fstatSync: fdOps.fstatSync,

  watch: fsWatch.watch,
  constants,

  invalidate(path) {
    contentCache.invalidate(resolvePath(path));
  },

  _metadataCache: metadataCache,
  _contentCache: contentCache,
  _watcherClient: watcherClient,
  _registerReadTransform: registerReadTransform,
  _removeReadTransform: removeReadTransform,
};
