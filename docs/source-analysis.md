# Ignis 0.8.10 源码全面分析

> 生成时间：2026-09-16 · 分析范围：monorepo 全部源码（apps/ignis-server、packages/{server-core,services,shim,bridge,ui}、apps/docs）

## 一、工程定位

**Ignis** 是一个"让 Obsidian 在浏览器中运行"的自托管服务端。它不包含任何 Obsidian 代码，而是提供一套 **Electron/Node API 兼容层（shim）**，把 Obsidian 对 Electron 后端的调用改道到自建的 Express 服务器（HTTP + WebSocket）。Obsidian 本体（1.12.7 解包版）在 Docker 首次启动时从官方源下载，存放于 `investigation/obsidian_1.12.7_unpacked/`（见 `apps/ignis-server/server/config.js`），磁盘上从不改动。

### 仓库结构（npm workspaces monorepo）

| 包 | 职责 | 规模 |
|---|---|---|
| `apps/ignis-server` | Express 服务器：fs 路由、vault 管理、代理、插件系统、headless-sync、demo 模式 | 核心，约 4000 行 |
| `packages/server-core` | 服务端共享库：chokidar 文件监视器、WS 服务器、写合并器、路径安全 | ~1000 行 |
| `packages/services` | 浏览器端 vaultService（vault CRUD 的 fetch/XHR 封装） | ~150 行 |
| `packages/shim` | **核心工程**：浏览器端 Electron/Node API 替换层 | ~5000 行 |
| `packages/bridge` | 注入 Obsidian 内部的"伪插件"，提供 Ignis 特有 UI/功能 | ~1600 行 |
| `packages/ui` | Svelte UI 包（VaultManager、SyncSetupModal、对话框组件） | ~1200 行 |
| `apps/docs` | Astro 文档站 | - |

构建：根 `build.js` 用 esbuild 把 shim 打成 `shim-loader.js`（IIFE）、UI 打成 `ignis-ui.js`（`window.IgnisUI`）、headless-sync 打成 `ignis-headless-sync.js`，并生成 `build-info.json`。

---

## 二、启动与加载链路（最精妙的部分）

1. **服务端** `apps/ignis-server/server/index.js`：Express 启动时读取 Obsidian 的 `index.html`，用正则提取其 `<script src>` 列表，再填入 Ignis 自己的模板 `server/assets/index.html`，以 `__OBSIDIAN_SCRIPTS__` JSON 形式内联。Obsidian 静态资源按 Obsidian 版本号加 `?v=` 参数做 immutable 缓存（`cache-headers.js`）。
2. **客户端** `packages/shim/src/loader.js`：先加载 shim（globals → require → CSS overrides → 移动端模拟），然后 `initialize()`（`init.js`）用**同步 XHR** 请求 `/api/bootstrap`——一次往返返回 vault 信息 + vault 列表 + 全量元数据树 + 插件列表，服务端预压缩（brotli/gzip 双份，`routes/bootstrap.js`）。
3. **预取门控**：`fs/indexer-prefetch.js` 把文件内容分成 **priority 切片**（`.obsidian/*.json` 配置 + 各插件 `main.js/manifest.json/styles.css`）和 **bulk 切片**（其余文本）。priority 切片的 Promise 挂在 `window.__ignisBootReady` 上，`index.html` 内联脚本等待它后才注入 Obsidian 的 scripts——保证 Obsidian 启动时同步读文件全部命中缓存，不触网。
4. **提取 obsidian 模块**：`virtual-plugin-loader.js:extractObsidianModule()` 用一个一次性合成插件加载 `require("obsidian")`，把捕获的模块存到 `window.__ignis.obsidian` 并注册为 shim，供 bridge 和虚拟插件复用。
5. **Bridge 加载**：动态 `import("@ignis/bridge")`，实例化 `IgnisBridgePlugin` 并 `onload()`，随后逐个加载 bootstrap 响应里声明的虚拟插件。

---

## 三、Shim 层：Node/Electron API 的浏览器替代

`require.js` 维护 `shimRegistry`，`window.require` 剥掉 `node:` 前缀后查表；未覆盖的模块返回空 Proxy 并告警（`debug.js` 提供 `__shimLog()` / `__shimMisses()` 调试）。

### 3.1 fs —— 全功能 HTTP 传输 + 双缓存（最核心）

- **MetadataCache**（`fs/metadata-cache.js`）：bootstrap 填充的全量 `{type,size,mtime,ctime}` 树。`existsSync/statSync/readdirSync` 纯内存返回，**永不触网**；`readdir` 用前缀扫描 + seen 去重实现。
- **ContentCache**（`fs/content-cache.js`）：50MB LRU（可在设置中调整），懒加载 + 预热。
- **transport**（`fs/transport.js`）：异步用 fetch（写操作带 `keepalive`，≤64KB 防卸载丢写）、同步用 XHR；二进制 base64 编解码；HTTP 错误码映射回 Node errno。
- **transforms 注册表**（`fs/transforms.js`）：三种钩子——路径解析器（workspace 重定向）、读变换（`core-plugins.json` 的 sync 掩码、`appearance.json` 强制 `nativeMenus:false`）、写变换（`workspaces.json` active 字段保真）。钩子在 shim 入口一次性执行，缓存只存物理路径，保证键一致。
- **写路径三层防护**：
  - 客户端 boot 期写合并器 `fs/write-coalescer.js`：100ms 静默 / 2s 上限，把 Obsidian 启动时密集的小写合并成几次往返；
  - 服务端写合并器 `packages/server-core/src/write-coalescer.js`：针对慢文件系统（rclone/FUSE），首写直落盘、窗口内缓冲立即响应（合成 mtime/size，防连接池饥饿），读回退读缓冲防脏读；失败退避重试 6 次后放弃并广播 `write-giveup`；
  - 客户端写持久化 `fs/write-durability.js`：失败写入按路径入队退避重试（8 次），`pagehide` / `visibilitychange` 时立即排空；非静默失败驱动状态栏信号与 Retry Notice。
- **文件描述符**（`fs/fd.js`）：虚拟 fd 映射到内存缓冲，支持 `open/read/close/fstat` 的 sync/callback 两种风格（Obsidian 大量用它）。
- **回显抑制**（`fs/echo-guard.js`）：本地操作打时间戳，1.5s 内忽略同路径的 watcher 事件，避免自己写的文件回弹成"修改"。
- **input-cache**（`fs/input-cache.js`）：浏览器文件选择器（importer 插件）选中的文件缓存到 `.obsidian/imports/` 虚拟路径，200MB / 5min TTL，避免走服务器往返。
- **watcher-client**（`fs/watcher-client.js`）：WS 事件驱动缓存更新；连接打开后按 ETag 拉 `/api/fs/tree` 全量 diff 对账（`reconcile`），补偿断线期间丢失的事件。

### 3.2 其它模块

- **electron**：`ipcRenderer` 是进程内路由器——同步通道（`vault`/`version`/`vault-open`/`starter` 等 30 个，`electron/ipc-renderer.js`）直接返回值，异步通道（`request-url`→代理、`print-to-pdf`→隐藏 iframe 打印、`context-menu`→下一 tick 回复）。`@electron/remote` 提供 clipboard/shell/dialog/Menu/BrowserWindow/nativeTheme/session/screen 等部分实现；`dialog.showOpenDialogSync` 用"先选文件缓存 + 调用方指纹匹配"的 workaround（`electron/remote/dialog.js`）。
- **crypto**：`@noble/hashes` 实现 SHA-1/256/512/MD5 真实摘要；`scrypt` 委托 Web Crypto（不可用时拒绝）；不安全上下文（非 localhost 的 HTTP）下 `globals/web-apis.js` 用 `getRandomValues` 补 `randomUUID`、用 noble 补 `subtle.digest`，其余 subtle 操作拒绝并上报 `ignis:insecure-api` 事件。
- **网络类**：`http/https` 可 import 但 request 即 error、createServer 抛错；`net` / `child_process` 全抛"web 版不可用"；`zlib` 用 pako 实现 sync + callback，流式类抛"未实现"；`stream` 只有骨架类，数据流方法告警。
- **fetch/requestUrl 拦截**（`globals/fetch.js`、`request-url.js`）：同源与 direct-fetch 白名单主机直连，其余跨域 POST 到 `/api/proxy`，模拟桌面端头 `Origin: app://obsidian.md`，响应体 base64 往返，二进制安全。
- **其它**：`path`（path-browserify + 根路径返回 vault 名）、`process`（伪 Electron 28 / Node 18）、`Buffer`（Uint8Array 子类，6 种编码）、`events`（手写 EventEmitter）、`util`、`assert`、`os`（Linux 身份伪装）。

---

## 四、服务端

### 4.1 路由总览（`routes/`）

- **`fs.js`**（575 行，最大文件）：stat/readFile/writeFile/appendFile/mkdir/rename/copyFile/unlink/rmdir/rm/access/utimes/batch-read/tree/download/download-zip。路径统一经 `resolveVaultPath` 双重防护：**词法检查**（拒绝 `../` 逃逸）+ **符号链接真实路径检查**（`path-utils.js:canonicalize` 深度 40 上限、悬空链接跟随目标，禁止软链逃出 vault）。每次变更都 `invalidateVault` 使 bootstrap 缓存失效；所有写路径都考虑与 write-coalescer 的 `pending` 缓冲交互（读/stat/download 优先读缓冲；rename/unlink/rm 先 flush 再取消缓冲防脏写落盘）。
- **`bootstrap.js`**：每 vault 一个缓存条目 `{response, dirMtimes, compressed:{br,gz}, etag}`；缓存有效性用目录 mtime 比对判定；`dirMtimesUnchanged` 全目录校验。`bootNonce + revisionCounter` 生成 ETag。
- **`proxy.js`**（512 行）：通用 CORS 代理。SSRF 防护完整：IPv4/IPv6 私网/回环/链路本地判定、DNS 全地址校验（`safeLookup` + `assertPublicUrl`）、每跳重查（手动跟随最多 5 次重定向，跨源跳转剥离 Authorization/Cookie）、响应体解压后重算 Content-Length、50MB 上限。`PROXY_ALLOW_PRIVATE_HOSTS` 支持精确 IP + IPv4 CIDR 白名单。
- **`vault.js`**：create/rename/remove，名字校验防路径穿越、Windows 保留名（`con/prn/aux` 等）；rename/remove 走 `withWatcherStopped`（`vault-lifecycle.js`）——先停 watcher，失败则恢复 watcher 并关闭该 vault 的 socket。
- **`settings.js`**：运行时可调设置（缓存大小、写合并窗口、proxyMode/allowlist、directFetchHosts），严格白名单校验，持久化到 `data/server-settings.json`；`wsOrigins` / `proxyAllowPrivate` 仅环境变量。
- **`plugins.js`**、**`version.js`**：插件 enable/disable；版本信息。

### 4.2 WebSocket（`server-core/ws.js`）

- 按 `?vault=` 分桶 `clientsByVault`，每 vault 共享一个 chokidar watcher（`watcher.js`，空闲 10 分钟自动停，`awaitWriteFinish` 300ms 防抖）。
- Origin 白名单校验（`WS_ORIGINS`）；30s ping/pong 心跳杀死僵尸连接。
- **频道机制**：`wss.channel(name)` 提供 `on/off/broadcastToVault`，客户端 `subscribe-channel` / `unsubscribe-channel` 消息按频道订阅门控广播——headless-sync 的状态/日志推送走的就是这条通道（`broadcaster.js`，channel `plugin:headless-sync`）。

### 4.3 插件体系（三层）

1. **Obsidian 社区插件**：直接跑在 Obsidian 内，require 走 shim；需要 child_process / native 模块的加载后首次调用即抛错。
2. **Ignis 服务端插件**（`plugin-system/`）：`server/plugins/<name>/index.js` 导出 `{id,name,register}`，register 拿到 `{config,wss,watcher,router,dataDir}`，启用时挂载 `/api/ext/<id>/`，按 vault 启停，状态持久化 `data/plugin-config.json`。目前唯一实现是 **headless-sync**：封装 [obsidian-headless](https://github.com/obsidianmd/obsidian-headless) CLI（`ob`），per-vault 子进程跑 `ob sync --continuous`（支持 `--pull-only` / `--mirror-remote`），进程状态/日志经 WS 广播；token 存 `data/plugins/headless-sync/`（0600 权限），HOME 重定向到插件数据目录以扛容器重建；win32 用 `taskkill /t /f` 杀进程树。
3. **虚拟插件**（`virtual-plugin-loader.js`）：Ignis 插件的浏览器侧伴侣——`fetch` 脚本 + `new Function` 执行 + 对 live `app` 实例化，从**不写入** `.obsidian/plugins/`；启用/禁用经 WS `virtual-plugin-enable/disable` 实时热切换，按 id 串行化防竞态，同源 URL 校验防注入。headless-sync 的伴侣 `ignis-headless-sync` 提供状态栏、设置页、以及 core-sync-guard（嗅探 `core-plugins.json` 变化，Obsidian Sync 一开就自动停 headless 并警告防冲突）。

### 4.4 Demo 模式（`server/demo/`）

`DEMO_MODE=true` 时：cookie 会话隔离（`demo-<sessionId>__<name>` 磁盘前缀）、每个会话 vault 数/字节数配额（超限 507）、代理仅允许 GitHub/Obsidian 发布域、隐藏服务端插件、页面加载容量门（满了返回 503 HTML）、60s 定时清理（过期会话 + 孤儿 `demo-*` 目录 + 配额漂移纠正）、WebSocket upgrade 也做前缀翻译。客户端对应钩子在 `packages/shim/src/demo.js`（预信任 + 自动 provision 重定向）与 `packages/bridge/src/demo-guards.js`（禁用所有 email/password 输入框）。

---

## 五、Bridge 与 UI

**Bridge**（常驻伪插件，`packages/bridge/src/main.js`）：上传/下载/ZIP 文件操作（`file-actions.js`，下载经 `/api/fs/download` 的 `<a download>` 触发）、右键菜单、"as Ignis URL"、`Open workspace in new tab` 命令（`workspace-picker.js`，FuzzySuggestModal + `?workspace=&load=preset`）、状态栏（连接点 + 写状态脉冲 + 失败 Retry/Reload Notice）、**loading-gate**（patch `MarkdownView.onLoadFile`，慢速加载时切阅读模式并挡输入，读完恢复原模式）、**image-retry**（`/vault-files/` 图片失败 3 次带缓存爆破重试）、Saving.../Saved 通知、不安全上下文与代理拦截提示（含 Details 弹窗）、设置注入（monkey-patch `setting.onOpen` 增加 "Ignis" 组，General 页有版本检查 + 服务器设置表单，Security 组管理 proxyMode/allowlist/direct-fetch；"Ignis Core Plugins" 组管理服务端插件开关，并从 Community plugins 列表中隐藏 Ignis 插件）。

**UI**（Svelte）：`VaultManager.svelte`（vault 列表/搜索/创建/重命名/删除对话框）、`SyncSetupModal`（headless-sync 远程 vault 列表与创建）、通用 Modal/Prompt/Confirm/Message 组件；经 `ui-registry.js` 的运行时注册表接入 shim（dialog 与 starter 通道复用）。

---

## 六、质量与工程实践

- **测试**：26 个 vitest 测试文件，集中在最易错的纯逻辑——shim fs（transforms/transport/write-coalescer/write-durability/metadata-cache/content-cache/fd/realpath/callback/sync-mutations/promises-mutations/watcher-client/ws-client）、crypto、buffer、proxy、version 等，每个模块暴露 `_reset()` 测试钩子。`scripts/check-error-leaks.mjs` 配合 oxlint 做错误泄漏检查。
- **安全实践突出**：路径穿越双重防护（词法 + 符号链接）、SSRF 四层防护（scheme/IP/DNS/重定向）、`sanitizeError` 只回传 errno 不泄路径、Content-Disposition RFC5987 编码防头注入、ZIP 下载跳过符号链接、虚拟插件同源断言、密钥文件 0600、Demo 模式禁凭据输入。
- **性能设计**：预压缩 bootstrap、双切片预热、批量并发预取（50/批 × 6 并发）、LRU 上限、写合并防连接池饥饿、ETag 304 对账、immutable 静态资源缓存。
- **少量 TODO/WIP**：插件 API 标注 `__WIP__`、`long` shim 置空等，反映其"作者日常自用驱动开发"的活跃迭代状态（版本 0.8.x，2026-08-20 发布）。

---

## 七、一句话总结

这是一个设计精巧的"OS 兼容层"工程——用双缓存 + 预取 + 写合并 + WS 实时同步把 Node 文件系统完整搬到 HTTP 之上，用事件驱动的 transforms 注册表解决配置文件的读写篡改问题，用三层插件体系（社区插件 / shim 化的 require 通道、服务端插件、虚拟插件）保持对 Obsidian 生态的最大兼容，同时以相当成熟的路径 / 网络安全防护支撑其"需要自挂反代鉴权"的部署模型。
