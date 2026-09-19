<section>
  <p align="center">
      <img src="images/ignis.png" alt="Ignis logo" width="200" height="200">
  </p>

  <h3 align="center">Ignis</h3>

  <p align="center">
    Run Obsidian in the browser. No remote desktop required.
  </p>

  <h3 align="center">
    <a href="https://ignis.thiefling.com/docs/server/deploy/">Setup instructions</a>
  </h3>

  <p align="center">
    <a href="https://ignis-demo.thiefling.com">Try the live demo</a>
    &middot;
    <a href="https://ignis.thiefling.com/docs/">Documentation</a>
  </p>
</section>

---

# Ignis — English

## What is this

Ignis is a compatibility shim that provides browser-compatible implementations of the Electron APIs used by Obsidian, allowing Obsidian to run in a standard browser while keeping your vault on the server. Obsidian is not included in or distributed with this project. The Docker container downloads Obsidian directly from its official source on first run.

### Why

While Obsidian's local-first approach works well for most users, options for accessing your own Obsidian installation remotely have been limited to VNC-based solutions with poor user experience. Ignis provides an alternative for users who want to access their own copy of Obsidian from a browser, in a close-to-native format.

### Project Status

Ignis is under active development as its original author's daily driver for note taking. It is still a new project, so gaps get documented and fixed as they go. You can look at the [roadmap](https://ignis.thiefling.com/docs/roadmap/) for an overview of major planned fixes and features.

**About this fork.** This repository (`gujin03/ignis`) is a fork of Ignis **0.8.10** with the bundled Obsidian runtime upgraded from **1.12.7 to 1.13.7** (Electron 39.8.3 / Node 22.20 / Chrome 142). On top of the upstream code it adds the 1.13.7 compatibility fixes, a Linux/amd64 image build toolchain, CI/CD workflows, and a Chinese documentation set under `docs/`. It follows the upstream release cadence where possible but is maintained independently.

## Quick start

Run Ignis with Docker Compose. Use the following compose file for a basic setup.

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
      # match these to your host user (run: id)
      - PUID=1000
      - PGID=1000
    volumes:
      - ./vaults:/vaults
      - ./data:/app/data
      - obsidian-app:/app/obsidian-app
    restart: unless-stopped

volumes:
  obsidian-app:
```

Save it as `docker-compose.yml`, then run `docker compose up -d` and open `http://localhost:8080`. The first start pulls Obsidian from its official source, so give it a minute or two. With no vaults yet, Ignis opens the vault manager to create your first one.

> [!IMPORTANT]
> Before exposing Ignis to other machines, put authentication in front of it and serve it over HTTPS. It has no built-in auth, so anyone who reaches an open instance can read and write the whole vault, and outside a secure context (HTTPS, or `localhost`) the browser disables features Ignis needs. See [Remote access](https://ignis.thiefling.com/docs/security/remote-access/) and [Authentication](https://ignis.thiefling.com/docs/security/authentication/).

> [!NOTE]
> The published image `nobbe/ignis:latest` tracks the upstream 0.8.10 release (Obsidian 1.12.7). To run **this fork's Obsidian 1.13.7** build, build from source — see [Development & Release](#development--release). The bundled `entrypoint.sh` downloads Obsidian **1.13.7** by default.

Full setup and configuration are in the [deploy guide](https://ignis.thiefling.com/docs/server/deploy/); the rest of the [documentation](https://ignis.thiefling.com/docs/) covers settings, security, and operations.

## Variants

Ignis currently ships as a self-hosted server, with a desktop plugin variant planned. The server variant lives in [`apps/ignis-server/`](apps/ignis-server/); setup is in the [documentation](https://ignis.thiefling.com/docs/server/deploy/).

## Features

- Core Obsidian: editor, canvas, bases, command palette, context menus, themes, and CSS snippets.
- Most community plugins built on Obsidian's plugin API. Plugins needing Node native modules or `child_process` do not load.
- File upload (ribbon, right-click, drag-and-drop) and download (files, or folders as ZIP).
- Multi-vault support with create, open, switch, rename, and delete, and a different vault per browser tab.
- Live sync between tabs over WebSocket, so edits propagate within a second.
- Saved workspaces opened in separate tabs via a `?workspace=` URL parameter.
- Notes can be opened directly by URL via a `?file=` parameter, with an "as Ignis URL" option in the note menu 'Copy path' section.
- Obsidian Sync in a logged-in tab, or server-side Headless Sync that runs without a tab open.
- A cross-origin proxy for plugin requests, with a direct-fetch allowlist for CORS-friendly hosts.
- A mobile UI on small screens.

See the [documentation](https://ignis.thiefling.com/docs/) for the full feature set and setup.

## Limitations

Running Obsidian in a browser means some Electron and Node capabilities have no equivalent, so certain plugins and features are limited or unavailable. See [Limitations](https://ignis.thiefling.com/docs/using/limitations/) and [Plugin compatibility](https://ignis.thiefling.com/docs/using/plugin-compatibility/) for details.

- **File pickers.** Some plugins (e.g. Importer) need a native file picker that cannot be emulated in a browser. Use a two-step flow: the first run stages a selected file; running the same action again serves the staged file to the plugin.
- **safeStorage.** When a plugin uses Electron's `safeStorage` to encrypt secrets, the browser has no equivalent, so data is stored in **plaintext**. Server-side encryption is planned.
- **Secure-context dependency.** Some Obsidian features require browser APIs available only in a secure context (HTTPS or `localhost`); they do not work over plain HTTP on other origins.
- **Spellcheck language.** The page cannot choose the browser's spellcheck language; Ignis disables that setting and points you to the browser's own settings.
- **Native menus.** The native-menu option in Appearance relies on Electron's menu API; Ignis keeps it off.

## Performance

A few design decisions worth knowing about for someone evaluating Ignis against large vaults or slow storage:

- A pre-compressed bootstrap response delivers vault info, vault list, metadata tree, and plugin list in a single call.
- Indexer pre-fetch warms the content cache so Obsidian's startup index hits cache instead of the network.
- An LRU content cache (50 MB by default) keeps memory use bounded regardless of vault size, so Ignis doesn't hold the whole vault in memory.
- Optional write coalescing debounces rapid writes for slow filesystems (rclone, FUSE, NFS, SMB); off unless `WRITE_COALESCE_MS` is set.

The content cache size and write coalescing can both be adjusted from the [Settings](https://ignis.thiefling.com/docs/using/settings/) panel.

## Obsidian 1.13.7 compatibility (this fork)

This fork upgrades the bundled Obsidian from 1.12.7 to **1.13.7** and applies the compatibility fixes below. Most features (images/lightbox, mobile UI, Headless Sync) worked unchanged; only the items below needed fixing.

- **Startup white screen.** Obsidian 1.13.x queries new IPC `sendSync` channels at boot (e.g. `terms`, `policy`). These were unimplemented, so Obsidian closed the window silently with no console error. Added standard responses for the license/terms/policy channels (and the other 1.13.x channels) so boot completes and the title becomes "— Obsidian 1.13.7".
- **Settings panel unreachable.** Obsidian 1.13 changed settings to a popout window; Ignis's popout guard parked it off-screen. Forced `settingsPopoutWindow` off **at runtime** (modal mode) without writing to the user's on-disk config.
- **Empty settings tab.** 1.13 requires each settings tab to expose `renderTab()`; the bridge's own tabs still used the legacy `display`. Provided both `display` and `renderTab` so the tabs satisfy both contracts.
- **Legacy bridge bugs.** Fixed two pre-existing unload/restore bugs in the bridge (incomplete teardown; incorrect restore path).
- **Tests.** Added automated tests covering the IPC-channel, settings-popout-guard, and web-frame behavior (see `packages/shim/src/electron/`).

The full upgrade narrative and lessons learned are in [`docs/升级经验总结.md`](docs/升级经验总结.md) (Chinese).

## Development & Release

Everything needed to run, build, package, and ship Ignis from source.

### Local development

```bash
npm ci                      # install dependencies
npm run dev                 # build bundles, then start the server on :8080
# open http://localhost:8080
```

- `npm test` – unit tests (vitest)
- `npm run lint` – oxlint + error-leak check
- `npm run build` – esbuild bundles (shim-loader, UI, headless-sync)

By default the server serves Obsidian from `investigation/obsidian_1.13.7_unpacked/`. Point `OBSIDIAN_ASSETS_PATH` at any extracted Obsidian directory to switch versions, or run in Docker where the entrypoint downloads it automatically (see below). To obtain the Obsidian assets locally, see [`HANDOFF.md`](HANDOFF.md) ("Obsidian 资产获取").

### Docker image (linux/amd64)

```bash
npm run docker:build        # build host arch, load as nobbe/ignis:dev
# multi-arch (amd64 + arm64) + push:
node apps/ignis-server/scripts/build-image.js --push
```

Production compose template and full build guide:
- [Production deployment](apps/ignis-server/examples/production/) – compose file with healthcheck, volumes, and hardening knobs
- [docs/docker-build.md](docs/docker-build.md) – buildx walkthrough, verification, rollback

### CI/CD

Three GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | push/PR to main | lint, unit tests, build artifact checks |
| `build-image.yml` | tag `v*`, manual | buildx multi-arch push to GHCR/Docker Hub |
| `deploy.yml` | after image build, manual | SSH to prod host: `compose pull && up -d` |

Release flow:

```bash
git tag v0.8.10 && git push origin v0.8.10   # CI gates, then image builds & pushes
```

End-to-end setup, secrets, and troubleshooting: [docs/ci-cd.md](docs/ci-cd.md).

## Environment variables

The server is configured through environment variables, set in the compose file's `environment:` block.

| Variable | Default | Description |
|---|---|---|
| `PORT` | 8080 | Server listen port |
| `VAULT_ROOT` | /vaults | Vault directory; each subfolder is a vault |
| `DATA_ROOT` | /app/data | Ignis state: server-plugin config, sync state, tokens |
| `OBSIDIAN_VERSION` | 1.13.7 | Obsidian version fetched on first run (this fork) |
| `OBSIDIAN_PACKAGE` | unset | Pre-placed Obsidian package path (.deb, .asar.gz, or .asar) for offline install |
| `OBSIDIAN_ASSETS_PATH` | /app/obsidian-app | Directory of the extracted Obsidian files |
| `PUID` | 1000 | User ID that writes files |
| `PGID` | 1000 | Group ID that writes files |
| `WS_ORIGINS` | unset | Allowlist of Origins (with scheme) for WebSocket connections |
| `PROXY_ALLOW_PRIVATE_HOSTS` | unset | Private IPs or CIDRs the cross-origin proxy may reach |
| `AUTO_CREATE_DEFAULT` | false | Auto-create "My Vault" on boot if none exists |
| `WRITE_COALESCE_MS` | 0 | Debounce window (ms) for rapid writes; max 60000 |
| `UV_THREADPOOL_SIZE` | 4 | Concurrent file ops; raise for large vaults on network filesystems |

> The upstream documentation still lists `OBSIDIAN_VERSION` default as 1.12.7. In **this fork** the default is **1.13.7** (see `apps/ignis-server/scripts/entrypoint.sh`).

## Security

### Authentication

Ignis has **no built-in login** and serves plain HTTP by default. Authentication and TLS termination must be handled by a front layer. Options:

- Reverse proxy + Basic Auth (nginx, Caddy, Traefik)
- SSO proxy (Authelia, Authentik, OAuth2 Proxy)
- VPN (Tailscale, WireGuard)
- Cloudflare Access

The `examples/` directory provides two complete Caddy configurations (Basic Auth and Authelia).

### Remote access

Obsidian's browser APIs are available only in a **secure context** (HTTPS or `localhost`). To reach Ignis from any origin other than `localhost`, you must either serve it over HTTPS (reverse proxy, `tailscale serve`, Cloudflare Tunnel) or mark the origin as secure in the browser (Chromium `chrome://flags/#unsafely-treat-insecure-origin-as-secure`; Firefox `dom.securecontext.allowlist`). Safari has no such setting and requires TLS.

### Hardening

- **Proxy safety.** The server-side proxy `/api/proxy` helps plugins reach CORS-restricted hosts. By default it rejects private, loopback, and link-local addresses (SSRF guard). Narrow it with the proxy allowlist in Settings, or grant specific private IPs/CIDRs via `PROXY_ALLOW_PRIVATE_HOSTS`.
- **WebSocket origin.** Set `WS_ORIGINS` to your Ignis origin to reject connections from other origins.

## Architecture

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details on the shim layer, plugin system, and server internals.

In short: Ignis replaces Obsidian's Electron backend with a shim that routes Node.js/Electron API calls to an Express server over HTTP and WebSocket. The browser side runs unmodified Obsidian plus the shim (fs/electron/node) and a Bridge (settings injection, status bar, image retry). The server side exposes `/api/fs/*`, `/api/vault/*`, `/api/plugins/*`, `/api/ext/:plugin/*`, etc., and stores vaults under `vaults/`. Obsidian's files are never modified on disk and never transformed in transit.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, especially on how to report plugin compatibility issues. For upstream plugin-compatibility tracking, see the [open issues](https://github.com/Nystik-gh/ignis/issues) on the original repository; fork-specific issues can be filed on this repository.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

## Legal Notice

Ignis is not affiliated with, endorsed by, or associated with Dynalist Inc. or Obsidian. It is an independently developed interoperability tool and contains no Obsidian source code, binaries, or assets. No part of Obsidian is distributed or included in this repository; the Docker container downloads Obsidian directly from its official source at runtime.

This work falls under the interoperability provisions of [Directive 2009/24/EC](https://eur-lex.europa.eu/eli/dir/2009/24/oj/eng) (the EU Software Directive), Article 6. See [LEGAL.md](LEGAL.md) for the full rationale.

This project exists because its author uses Obsidian daily and wants to access it from a browser. There is no intent to harm Obsidian, Dynalist Inc., or their business. If you are a representative of Dynalist Inc. and wish to discuss this project, please reach out: ignis@thiefling.com

---

# Ignis — 中文版

## 项目简介

Ignis 是一层**兼容层（shim）**：它用浏览器兼容的实现替换 Obsidian 所依赖的 Electron API，让 Obsidian 能在标准浏览器中运行，同时把你的笔记库（Vault）保留在服务器上。Obsidian 本身**不包含在本项目中，也不随项目分发**——Docker 容器在首次启动时直接从官方源下载 Obsidian。

### 为什么做这个

Obsidian 采用「本地优先」理念，对多数人很好用；但想要远程访问自己的 Obsidian，过去只能依赖 VNC 这类远程桌面方案，体验很差。Ignis 提供了一种替代方案：你可以在浏览器里以接近原生的形式访问属于你自己的那份 Obsidian。

### 项目状态

Ignis 仍在积极开发中，是原作者日常记笔记的主力工具。项目还比较新，遇到的问题会被持续记录并修复。可在[路线图](https://ignis.thiefling.com/docs/roadmap/)查看主要规划中的修复与功能。

**关于本 fork。** 本仓库（`gujin03/ignis`）基于 Ignis **0.8.10** 派生，将内置 Obsidian 运行时从 **1.12.7 升级到 1.13.7**（Electron 39.8.3 / Node 22.20 / Chrome 142）。在源码基础上，本 fork 额外提供了 1.13.7 兼容性修复、Linux/amd64 镜像构建工具链、CI/CD 工作流，以及 `docs/` 下的中文文档集。本 fork 尽可能跟随上游发布节奏，但独立维护。

## 快速开始

使用 Docker Compose 运行 Ignis。以下 compose 文件为最简配置。

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
      # 与宿主机用户对齐（运行 id 查看）
      - PUID=1000
      - PGID=1000
    volumes:
      - ./vaults:/vaults
      - ./data:/app/data
      - obsidian-app:/app/obsidian-app
    restart: unless-stopped

volumes:
  obsidian-app:
```

保存为 `docker-compose.yml`，运行 `docker compose up -d`，打开 `http://localhost:8080`。首次启动会从官方源拉取 Obsidian，请等待一两分钟。若还没有 Vault，Ignis 会打开 Vault 管理器来创建第一个。

> [!IMPORTANT]
> 在将 Ignis 暴露给其他机器之前，请在其前面加上身份认证，并通过 HTTPS 提供服务。它**没有内置认证**，任何能访问到开放实例的人都可以读写整个 Vault；并且在非安全上下文（HTTPS 或 `localhost` 之外）下，浏览器会禁用 Ignis 所需的功能。参见[远程访问](https://ignis.thiefling.com/docs/security/remote-access/)与[身份认证](https://ignis.thiefling.com/docs/security/authentication/)。

> [!NOTE]
> 已发布的镜像 `nobbe/ignis:latest` 跟随上游 0.8.10 版本（Obsidian 1.12.7）。若要运行**本 fork 的 Obsidian 1.13.7** 构建，请从源码构建——见[开发与发布](#开发与发布)。内置的 `entrypoint.sh` 默认下载 Obsidian **1.13.7**。

完整的部署与配置见[部署指南](https://ignis.thiefling.com/docs/server/deploy/)；其余[文档](https://ignis.thiefling.com/docs/)涵盖设置、安全与运维。

## 形态

Ignis 目前以自托管服务端形式发布，桌面插件形态在规划中。服务端代码位于 [`apps/ignis-server/`](apps/ignis-server/)；部署方式见[文档](https://ignis.thiefling.com/docs/server/deploy/)。

## 功能特性

- 核心 Obsidian：编辑器、画布（Canvas）、白板（Bases）、命令面板、右键菜单、主题与 CSS 片段。
- 大多数基于 Obsidian 插件 API 开发的社区插件可正常运行；依赖 Node 原生模块或 `child_process` 的插件无法加载。
- 文件上传（功能条、右键、拖拽）与下载（文件，或文件夹打包为 ZIP）。
- 多 Vault 支持：创建、打开、切换、重命名、删除，且每个浏览器标签页可打开不同的 Vault。
- 标签页之间通过 WebSocket 实时同步，编辑内容在 1 秒内传播。
- 通过 `?workspace=` 参数在独立标签页打开已保存的工作区布局。
- 通过 `?file=` 参数用 URL 直接打开笔记，笔记菜单「复制路径」中提供「as Ignis URL」选项。
- 在已登录的标签页中使用 Obsidian Sync，或在服务端运行 Headless Sync（无需打开标签页也能同步）。
- 为插件请求提供跨域代理，并对 CORS 友好的主机配置直连白名单。
- 小屏幕下的移动端界面。

完整功能集与配置见[文档](https://ignis.thiefling.com/docs/)。

## 局限性

在浏览器中运行 Obsidian 意味着部分 Electron 与 Node 能力没有对等实现，因此某些插件与功能受限或不可用。详见[局限性](https://ignis.thiefling.com/docs/using/limitations/)与[插件兼容性](https://ignis.thiefling.com/docs/using/plugin-compatibility/)。

- **文件选择器。** 部分插件（如 Importer）需要浏览器无法模拟的原生文件选择器。采用两步流程：首次运行先暂存所选文件，再次运行相同操作时 Ignis 将暂存文件提供给插件。
- **safeStorage。** 插件用 Electron 的 `safeStorage` 加密敏感数据时，浏览器无对等能力，数据将以**明文**存储。服务端加密已在规划中。
- **安全上下文依赖。** 部分 Obsidian 功能依赖仅在安全上下文（HTTPS 或 `localhost`）下可用的浏览器 API，在纯 HTTP 的其他来源下无法工作。
- **拼写检查语言。** 页面无法选择浏览器的拼写检查语言；Ignis 禁用该设置并引导你使用浏览器自身设置。
- **原生菜单。** 外观设置中的原生菜单选项依赖 Electron 的菜单 API；Ignis 将其保持关闭。

## 性能

以下设计决策值得在「用大 Vault 或慢速存储评估 Ignis」时了解：

- 预压缩的启动响应在一次调用中返回 Vault 信息、Vault 列表、元数据树与插件列表。
- 索引器预取预热内容缓存，使 Obsidian 的启动索引命中缓存而非网络。
- LRU 内容缓存（默认 50MB）将内存占用限制在 Vault 大小之外，Ignis 不会把整个 Vault 装入内存。
- 可选的写合并对慢速文件系统（rclone、FUSE、NFS、SMB）上的快速写入做防抖；未设置 `WRITE_COALESCE_MS` 时关闭。

内容缓存大小与写合并均可在[设置](https://ignis.thiefling.com/docs/using/settings/)面板中调整。

## Obsidian 1.13.7 兼容性（本 fork）

本 fork 将内置 Obsidian 从 1.12.7 升级到 **1.13.7**，并应用了以下兼容性修复。多数功能（图片灯箱、移动端界面、Headless Sync）无需改动即可工作，仅以下各项需要修复。

- **启动白屏。** Obsidian 1.13.x 在启动时会查询若干新的 IPC `sendSync` 通道（如 `terms`、`policy`）。此前未实现，导致 Obsidian 静默关闭窗口且控制台无报错。为此补齐了许可/条款/策略等通道（以及 1.13.x 的其他通道）的标准应答，启动得以完成，标题变为「— Obsidian 1.13.7」。
- **设置面板点不开。** Obsidian 1.13 将设置改为独立弹窗；Ignis 的弹窗守卫把它停在了屏幕外。**在运行时强制关闭** `settingsPopoutWindow`（modal 模式），且不写入用户磁盘上的配置文件。
- **设置页无内容。** 1.13 要求每个设置页提供 `renderTab()`；Ignis 自有设置页仍使用旧的 `display`。同时提供 `display` 与 `renderTab`，使两种契约都满足。
- **旧有 bridge bug。** 修复了 bridge 中两处既有的卸载/还原 bug（卸载不彻底；还原方式不正确）。
- **测试。** 新增覆盖 IPC 通道、settings-popout-guard 与 web-frame 行为的自动化测试（见 `packages/shim/src/electron/`）。

完整的升级过程与经验总结见 [`docs/升级经验总结.md`](docs/升级经验总结.md)。

## 开发与发布

从源码运行、构建、打包与发布 Ignis 所需的一切。

### 本地开发

```bash
npm ci                      # 安装依赖
npm run dev                 # 构建产物，然后在 :8080 启动服务
# 打开 http://localhost:8080
```

- `npm test` – 单元测试（vitest）
- `npm run lint` – oxlint + error-leak 检查
- `npm run build` – esbuild 产物（shim-loader、UI、headless-sync）

默认服务从 `investigation/obsidian_1.13.7_unpacked/` 提供 Obsidian。将 `OBSIDIAN_ASSETS_PATH` 指向任意解包好的 Obsidian 目录即可切换版本；或在 Docker 中由 entrypoint 自动下载（见下）。本地获取 Obsidian 资产的方式见 [`HANDOFF.md`](HANDOFF.md)（「Obsidian 资产获取」）。

### Docker 镜像（linux/amd64）

```bash
npm run docker:build        # 构建本机架构并加载为 nobbe/ignis:dev
# 多架构（amd64 + arm64）构建并推送：
node apps/ignis-server/scripts/build-image.js --push
```

生产 compose 模板与完整构建指南：
- [生产部署](apps/ignis-server/examples/production/) – 含健康检查、卷映射与加固参数的 compose 文件
- [docs/docker-build.md](docs/docker-build.md) – buildx 演练、验证与回滚

### CI/CD

`.github/workflows/` 下有三个 GitHub Actions 工作流：

| 工作流 | 触发条件 | 作用 |
|---|---|---|
| `ci.yml` | 推送到 main / PR | lint、单元测试、构建产物检查 |
| `build-image.yml` | 打 `v*` 标签 / 手动 | buildx 多架构推送到 GHCR/Docker Hub |
| `deploy.yml` | 镜像构建后 / 手动 | SSH 到生产机：`compose pull && up -d` |

发布流程：

```bash
git tag v0.8.10 && git push origin v0.8.10   # CI 门禁通过后构建并推送镜像
```

端到端配置、密钥与排障见 [docs/ci-cd.md](docs/ci-cd.md)。

## 环境变量

服务通过环境变量配置，在 compose 文件的 `environment:` 块中设置。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 8080 | 服务监听端口 |
| `VAULT_ROOT` | /vaults | Vault 目录，每个子文件夹为一个 Vault |
| `DATA_ROOT` | /app/data | Ignis 状态目录：服务端插件配置、同步状态、令牌 |
| `OBSIDIAN_VERSION` | 1.13.7 | 首次运行时获取的 Obsidian 版本（本 fork） |
| `OBSIDIAN_PACKAGE` | 未设置 | 预置 Obsidian 包路径（.deb、.asar.gz 或 .asar），用于离线安装 |
| `OBSIDIAN_ASSETS_PATH` | /app/obsidian-app | 解压后的 Obsidian 文件存放位置 |
| `PUID` | 1000 | 写入文件的用户 ID |
| `PGID` | 1000 | 写入文件的组 ID |
| `WS_ORIGINS` | 未设置 | WebSocket 连接允许的 Origin 白名单（含 scheme） |
| `PROXY_ALLOW_PRIVATE_HOSTS` | 未设置 | 跨域代理可访问的私有 IP 或 CIDR |
| `AUTO_CREATE_DEFAULT` | false | 启动时若无 Vault 则自动创建「My Vault」 |
| `WRITE_COALESCE_MS` | 0 | 快速写入的防抖窗口（毫秒），最大 60000 |
| `UV_THREADPOOL_SIZE` | 4 | 并发文件操作数；网络文件系统上的大 Vault 可调高 |

> 上游文档仍将 `OBSIDIAN_VERSION` 默认值列为 1.12.7。在**本 fork** 中默认值为 **1.13.7**（见 `apps/ignis-server/scripts/entrypoint.sh`）。

## 安全

### 身份认证

Ignis **没有内置登录**，默认以纯 HTTP 提供服务。身份认证与 TLS 终止必须由前置层处理。可选方案：

- 反向代理 + Basic Auth（nginx、Caddy、Traefik）
- SSO 代理（Authelia、Authentik、OAuth2 Proxy）
- VPN（Tailscale、WireGuard）
- Cloudflare Access

`examples/` 目录提供了两份完整的 Caddy 配置（Basic Auth 与 Authelia）。

### 远程访问

Obsidian 的浏览器 API 仅在**安全上下文**（HTTPS 或 `localhost`）中可用。若要从 `localhost` 以外的来源访问 Ignis，必须要么通过 HTTPS 提供服务（反向代理、`tailscale serve`、Cloudflare Tunnel），要么在浏览器中将来源标记为安全（Chromium `chrome://flags/#unsafely-treat-insecure-origin-as-secure`；Firefox `dom.securecontext.allowlist`）。Safari 无此设置，必须使用 TLS。

### 加固建议

- **代理安全。** 服务端代理 `/api/proxy` 帮助插件访问受 CORS 限制的主机。默认拒绝私有、回环与链路本地地址（SSRF 防护）。可在设置中用代理白名单收窄范围，或通过 `PROXY_ALLOW_PRIVATE_HOSTS` 授予特定私有 IP/CIDR 访问权限。
- **WebSocket 来源。** 将 `WS_ORIGINS` 设为你的 Ignis 来源，以拒绝其他来源的连接。

## 架构

架构详情（shim 层、插件体系、服务端内部）见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

简而言之：Ignis 用一层 shim 替换 Obsidian 的 Electron 后端，将 Node.js/Electron API 调用通过 HTTP 与 WebSocket 路由到 Express 服务器。浏览器侧运行未修改的 Obsidian 加 shim（fs/electron/node）与 Bridge（设置注入、状态栏、图片重试）；服务端暴露 `/api/fs/*`、`/api/vault/*`、`/api/plugins/*`、`/api/ext/:plugin/*` 等端点，Vault 存放在 `vaults/`。Obsidian 的文件在磁盘上从不修改，在传输中也不转换。

## 贡献

欢迎贡献。参见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解规范，尤其是如何上报插件兼容性问题。上游的插件兼容性追踪见原仓库的[开放 issue](https://github.com/Nystik-gh/ignis/issues)；本 fork 特有的问题可在本仓库提交。

## 许可证

本项目基于 [GNU Affero General Public License v3.0](LICENSE) 许可。

## 法律声明

Ignis 与 Dynalist Inc. 或 Obsidian 无隶属、背书或关联关系。它是一个独立开发的可互操作工具，不包含任何 Obsidian 源代码、二进制或资源。本仓库不分发、不包含任何 Obsidian 部分；Docker 容器在运行时直接从官方源下载 Obsidian。

本工作依据 [Directive 2009/24/EC](https://eur-lex.europa.eu/eli/dir/2009/24/oj/eng)（欧盟软件指令）第 6 条的可互操作条款。完整论证见 [LEGAL.md](LEGAL.md)。

本项目的存在是因为作者每日使用 Obsidian，并希望从浏览器访问它。无意损害 Obsidian、Dynalist Inc. 或其业务。若你是 Dynalist Inc. 的代表并希望讨论本项目，请联系：ignis@thiefling.com
