# Ignis 工程交接说明（HANDOFF）

> 目标：让另一台 PC 上的 AI agent（或开发者）在零背景的情况下，基于本包继续开发或部署。

## 这是什么

**Ignis 0.8.10** —— 让 Obsidian 在浏览器中运行的自托管服务端。通过一层 Electron/Node API 兼容层（shim），把 Obsidian 对 Electron 的调用改道到 Express 服务器（HTTP + WebSocket）。Obsidian 本体不包含在本包中（见"缺失内容"）。

**已从 Obsidian 1.12.7 升级到 1.13.7**（Electron 39.8.3 / Node 22.20 / Chrome 142）。

## 接手前必读（按顺序）

| 文档 | 内容 |
|---|---|
| `README.md` → Development & Release | 开发/构建/Docker/CI 的入口索引 |
| `docs/ARCHITECTURE.md` | 架构：shim 层、fs 双缓存、write-coalescer、三层插件体系、demo 模式 |
| `docs/source-analysis.md` | 源码全面分析报告（各子系统、安全、性能设计） |
| `docs/docker-build.md` | linux/amd64 镜像构建方案 |
| `docs/ci-cd.md` | CI/CD 工作流（.github/workflows/） |
| `docs/ignis官方说明文档.md` | 部署、安全、环境变量、限制 |

## 快速启动

```bash
npm ci                    # 安装依赖（package-lock.json 精确复现）
npm run build             # 构建前端产物（shim-loader / ui / headless-sync）
npm run dev               # 构建 + 启动服务，访问 http://localhost:8080
```

其他命令：

```bash
npm test                  # vitest 单测（Windows 偶发 worker 崩溃时逐文件跑）
npm run lint              # oxlint + error-leak check
npm run docker:build      # 本机构建镜像（需 Docker）
node apps/ignis-server/scripts/build-image.js --push   # 多架构推送
```

## 升级 1.13.7 已完成的修复（git log 可查）

| 提交 | 内容 |
|---|---|
| `29ccff4` | IPC 通道补齐（terms/policy 等 9 个）——修复启动空白页 |
| `6221bb4` | 设置 tab 适配 1.13.x `renderTab()` 契约 |
| `75cb137` | settings-popout-guard——强制设置面板 modal 模式（不污染磁盘） |
| `ee312f0` | loading-gate / inject 卸载 bug 修复 |
| `9e902bf` | 3 个新测试文件（ipc-renderer / settings-popout-guard / web-frame） |

## 缺失内容与恢复方式

本包**有意排除**以下内容，接收方按需恢复：

| 缺失项 | 大小 | 恢复方式 |
|---|---|---|
| `node_modules/` | 330M | `npm ci` |
| `packages/*/dist/` | ~1M | `npm run build` |
| `investigation/obsidian_1.13.7_unpacked/` | 26M | 见下方 Obsidian 资产获取 |
| `vaults/` | - | 新库自动创建；旧笔记自行迁移 |
| `data/` | - | 运行时自动创建 |
| `.cac/` `.playwright-mcp/` | 92K | 本机工具配置，无需 |

### Obsidian 资产获取（必须，否则服务无 Obsidian 可加载）

**方式 1（在线，Docker）**：直接 `npm run docker:build` + 运行，entrypoint.sh 首次启动自动下载。

**方式 2（在线，本地开发）**：

```bash
mkdir -p investigation
curl -fSL -o /tmp/obsidian.asar.gz \
  "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian-1.13.7.asar.gz"
# 解压 asar（在 /tmp 下）
gzip -d obsidian.asar.gz
npx @electron/asar extract obsidian.asar investigation/obsidian_1.13.7_unpacked
```

> 下载慢时用 `curl -C -` 断点续传。

**方式 3（离线）**：任一路径放置解包好的 Obsidian，设置 `OBSIDIAN_ASSETS_PATH` 指向它。

> 若想切换 Obsidian 版本：改 `OBSIDIAN_VERSION` 环境变量（服务端）或换 `investigation/` 目录（本地），`config.js:obsidianAssetsPath` 是默认路径。

## 架构速览（30 秒版）

```
Browser                              Server
Obsidian (未修改)   ◄─HTTP/WS─►   Express (/api/fs, /api/vault, /api/plugins...)
       ↕                               ↕
Shim 层 (fs/electron/node shim)    Filesystem (vaults/)
       ↕
Bridge (Ignis 伪插件: 设置注入/状态栏/图片重试)
```

- **fs shim**：HTTP 传输 + 元数据缓存（全量树，stat/exists 永不触网）+ 内容 LRU（50MB）
- **写路径**：客户端 write-coalescer（boot 期合并）→ 服务端 write-coalescer（慢盘缓冲）→ write-durability（失败重试）
- **transforms 注册表**：路径重定向/读变换/写变换（workspace 多 tab、nativeMenus、settingsPopoutWindow 的运行时强制）
- **IPC shim**：`ipcRenderer.sendSync` 30+ 通道直接映射（terms/policy 是 1.13.x 启动必须）
- **插件三层**：社区插件（require 走 shim）/ 服务端插件（headless-sync）/ 虚拟插件（不写盘）
- **安全**：路径双重防护（词法+符号链接）、SSRF 四层防护、sanitizeError、CSP 代理白名单

## 已知注意事项

1. **Windows 测试**：`npm test` 偶发 `ERR_IPC_CHANNEL_CLOSED`（vitest worker + chokidar），逐文件跑可区分环境问题与代码问题；CI 跑 ubuntu 无此问题。
2. **服务无内置认证**：部署必须置于反代（caddy-basic-auth / caddy-authelia 示例）或 VPN 之后，且除 localhost 外必须 HTTPS。
3. **开发期 Obsidian 资产**：`investigation/` 被 `.gitignore`/`.dockerignore` 忽略，不入 git。
4. **headless-sync**：依赖 `obsidian-headless` CLI（容器运行时安装），未装则仅提示不可用，不影响其余功能。
5. **`.gitignore` 含 `.cac/`、`.playwright-mcp/`**：本机 AI 工具配置，勿提交。

## 生产部署入口

- compose 模板：`apps/ignis-server/examples/production/`（linux/amd64 固定、healthcheck、卷映射）
- CI/CD：`.github/workflows/`（ci / build-image / deploy）+ `docs/ci-cd.md`
- 发布：`git tag v0.8.10 && git push origin v0.8.10`
