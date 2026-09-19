# Ignis 文档整合

本文档整合了 Ignis 官方文档站点 (https://ignis.thiefling.com/) 的核心内容，涵盖项目概述、系统要求、部署、安全、使用说明及扩展能力。

---

## 一、项目概述

Ignis 是一个让 Obsidian 在浏览器中运行的兼容层工具。它通过实现 Obsidian 所依赖的 Electron API 的浏览器兼容版本，使 Obsidian 能够以原生 Web 应用的形式在任何现代浏览器中运行，同时将 vault 保留在服务器上。

**核心特性：**
- **原生 Web 体验**：无需 VNC/Kasm 等远程桌面方案，Obsidian 直接在浏览器中运行。
- **完整的核心功能**：支持编辑器、Canvas、Bases、命令面板、右键菜单、主题和 CSS 片段。
- **插件支持**：大多数基于 Obsidian 插件 API 的社区插件可正常运行；但依赖 Node 原生模块或 `child_process` 的插件无法加载。
- **文件管理**：支持文件上传（功能条、右键、拖拽）和下载（文件或文件夹打包为 ZIP）。
- **多 Vault 支持**：可创建、打开、切换、重命名和删除 Vault，每个浏览器标签页可打开不同的 Vault。
- **实时同步**：通过 WebSocket 实现标签页之间的实时同步，编辑内容在 1 秒内传播。
- **Obsidian Sync**：支持完整 Obsidian Sync，包括 Headless Sync（服务端同步，无需浏览器标签页保持打开）。
- **移动端 UI**：在小屏幕上自动启用移动端界面。

**项目状态**：Ignis 处于积极开发中，版本为 v0.8.10，目前作为自托管服务器发布，桌面插件版本在规划中。

---

## 二、系统要求

运行 Ignis 需要满足以下条件：

| 要求 | 说明 |
|---|---|
| **Docker** | 服务器上安装 Docker Engine，或工作站上安装 Docker Desktop |
| **现代浏览器** | 已测试 Chrome、Brave、Firefox；Safari 测试有限 |
| **安全上下文** | Obsidian 依赖的浏览器 API 仅在 HTTPS 或 `localhost` 下可用。通过纯 HTTP 在其他来源（如局域网 IP 或裸域名）访问时，部分功能将无法工作 |
| **认证层** | Ignis 目前**没有内置认证**，任何可达实例都应置于反向代理或 VPN 之后 |

---

## 三、Docker 部署

Ignis 以 Docker 容器形式运行。在已安装 Docker 的机器上，创建以下 `docker-compose.yml` 文件即可启动：

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
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

**持久化路径说明**：
- `./vaults`：存放 Vault，每个子文件夹对应一个 Vault。
- `./data`：存放 Ignis 状态，如服务端插件设置和同步配置。
- `obsidian-app`：缓存下载的 Obsidian，避免容器重建时重复下载。

**启动步骤**：
1. 保存文件后运行 `docker compose up -d`。
2. 首次启动会下载 Obsidian 和 `obsidian-headless` CLI，需要一两分钟。
3. 访问 `http://localhost:8080`（或映射的端口），Ignis 将在浏览器中加载。若 `vaults` 文件夹中已有 Vault，会自动加载；否则打开 Vault 管理器创建第一个 Vault。

**文件权限**：Ignis 以 `PUID` 和 `PGID`（默认 1000）指定的用户和组写入文件。如果宿主机账户使用不同的 ID，需在 compose 文件中调整这两个值。

### 3.1 从源码构建镜像（linux/amd64）

工程内置镜像构建工具链（`apps/ignis-server/Dockerfile` + `scripts/build-image.js`），无需手动编写 Dockerfile：

```bash
# 构建本机架构并加载为 nobbe/ignis:dev
npm run docker:build            # 等价于 node apps/ignis-server/scripts/build-image.js

# 多架构（linux/amd64 + linux/arm64）构建并推送 registry
node apps/ignis-server/scripts/build-image.js --push

# 只构建单一平台 linux/amd64
docker buildx build --builder ignis-builder --platform linux/amd64 \
  -f apps/ignis-server/Dockerfile -t <your-image>:<version> --push .
```

构建要点：

- **多阶段构建**：build 阶段用 `node:22-slim` + esbuild 产出前端产物，runtime 阶段镜像精简（不含构建工具）
- **镜像不含 Obsidian**：首次运行由 `entrypoint.sh` 下载 `OBSIDIAN_VERSION`（默认 1.13.7）并解包到 `/app/obsidian-app`
- **架构无关**：Dockerfile 无架构专属依赖，amd64/arm64 通用
- **构建参数**：`IGNIS_IMAGE` 自定义镜像名、`ARG IGNIS_BUILD` 注入构建戳、`--push`/`--no-latest` 控制推送与 tag

完整方案（含验证清单、CI 集成、回滚）见 **[docs/docker-build.md](./docker-build.md)**。

---

## 四、安全配置

### 4.1 认证

Ignis **没有内置登录**，默认以纯 HTTP 提供服务。身份认证和 TLS 终止都需要由前置层处理。可选的认证方案包括：
- 反向代理 + Basic Auth（nginx、Caddy、Traefik）
- SSO 代理（Authelia、Authentik、OAuth2 Proxy）
- VPN（Tailscale、WireGuard）
- Cloudflare Access

仓库的 `examples/` 目录提供了两个完整的 Caddy 配置示例，分别使用 Basic Auth 和 Authelia。

### 4.2 远程访问

Obsidian 依赖的浏览器 API 仅在**安全上下文**（HTTPS 或 `localhost`）中可用。如果要从 `localhost` 以外的来源访问 Ignis，必须满足以下条件之一：

**方案一：通过 HTTPS 服务**
- 反向代理（Caddy、nginx、Traefik），适用于面向互联网的场景。
- `tailscale serve`：在 tailnet 中提供 HTTPS，无需证书管理。
- Cloudflare Tunnel：通过 Cloudflare 边缘以 HTTPS 到达 Ignis，无需端口转发或证书。

**方案二：将来源标记为安全（仅限 LAN，不推荐）**
- **Chromium 系浏览器**：打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，启用后输入 Ignis 来源地址（如 `http://192.168.1.10:8080`），重启浏览器。
- **Firefox**：在 `about:config` 中将主机添加到 `dom.securecontext.allowlist`。
- **Safari**：无等效设置，必须使用 TLS。

### 4.3 加固建议

**代理安全**：Ignis 运行服务端代理 `/api/proxy` 以帮助插件访问受 CORS 限制的主机。默认情况下，代理可访问任何公共主机，但会拒绝私有、回环和链路本地地址，以防止 SSRF 攻击。可通过以下设置缩小代理范围：
- **Allowlist**：在 Settings 面板中限制代理只能访问特定主机。
- **PROXY_ALLOW_PRIVATE_HOSTS**：如果需要访问 LAN 服务，可授予特定私有 IP 或 CIDR 的访问权限，但应保持最小化。

**WebSocket 来源限制**：Ignis 通过 WebSocket 推送 Vault 变更，默认接受任何来源的连接。设置 `WS_ORIGINS` 环境变量为 Ignis 的服务来源，可拒绝其他来源的连接。

---

## 五、使用说明

### 5.1 设置

Ignis 在 Obsidian 的设置中添加了自己的标签页，用于配置运行中的服务器、查看 Ignis 版本和服务器状态。部分设置需要刷新页面后生效。

| 设置项 | 默认值 | 说明 |
|---|---|---|
| **Content cache** | 50 MB | 内存中缓存文件内容，避免重新打开文件时重新获取。大 Vault 或慢速存储可调高 |
| **Input cache** | 200 MB | 存放文件对话框中选择的文件（如 Importer 插件） |
| **Input cache TTL** | 5 分钟 | 所选文件在被丢弃前的保留时间 |
| **Max request body** | 50 MB | 服务器接受的最大请求大小 |
| **Proxy access** | Any public host | 控制插件可通过 CORS 代理访问的外部主机。可设置为 Allowlist only 或 Disabled |
| **Write coalesce window** | 0（关闭） | 对慢速文件系统（rclone、NFS、SMB）上的快速写入进行防抖，最大 60000 ms |

### 5.2 局限性

在浏览器中运行 Electron 应用存在一些无法完美解决的限制：

- **文件选择器**：某些插件（如 Importer）需要无法在浏览器中模拟的文件选择器。使用此类操作时需分两步：首次运行会要求选择文件并暂存，再次运行相同操作时 Ignis 将暂存文件提供给插件。
- **safeStorage 加密**：插件使用 Electron 的 `safeStorage` 加密敏感数据时，由于浏览器没有等效功能，数据将以**明文**存储。服务端加密已在规划中。
- **安全上下文依赖**：部分 Obsidian 功能需要安全上下文（HTTPS 或 `localhost`）下的浏览器 API，在纯 HTTP 的其他来源下无法工作。
- **拼写检查语言**：页面无法选择浏览器的拼写检查语言，Ignis 禁用了该设置并引导用户使用浏览器自身设置。
- **原生菜单**：外观设置中的原生菜单选项依赖 Electron 的菜单 API，Ignis 将其保持关闭。

### 5.3 插件兼容性

大多数基于 Obsidian 插件 API 构建的社区插件可正常运行。插件无法工作的常见原因是需要浏览器不具备的 Node 或操作系统功能。

**以下类型的插件无法工作**：
- 需要通过 Node `child_process` 启动的外部程序。
- 需要通过 Node `net` 打开的原生网络套接字。
- 需要从编译的 `.node` 二进制文件加载的原生模块。

具体社区插件的兼容性在 [issue #9](https://github.com/Nystik-gh/ignis/issues/9) 中追踪。

### 5.4 服务端插件

服务端插件是 Ignis 自己的插件，运行在服务器上，与 Obsidian 社区插件相互独立。在 Obsidian 设置的 **Ignis Core Plugins** 标签页中按 Vault 启用。

**Headless Sync**：Obsidian Sync 核心插件只能在浏览器标签页中运行时工作，关闭标签页后停止同步。Headless Sync 通过 `obsidian-headless` CLI 在服务器上运行相同的 Obsidian Sync，即使没有浏览器标签页打开，Vault 也能持续同步。启用后在设置中登录 Obsidian Sync 账户并关联 Vault，Headless Sync 将持续在后台同步，容器重启后恢复。

---

## 六、环境变量

服务器通过环境变量配置，在 compose 文件的 `environment:` 块中设置。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 8080 | 服务器监听端口 |
| `VAULT_ROOT` | /vaults | Vault 存放目录，每个子文件夹对应一个 Vault |
| `DATA_ROOT` | /app/data | Ignis 状态目录：服务端插件配置、同步状态和令牌 |
| `OBSIDIAN_VERSION` | 1.12.7 | 首次运行时获取的 Obsidian 版本 |
| `OBSIDIAN_PACKAGE` | 未设置 | 预置 Obsidian 包路径（.deb、.asar.gz 或 .asar），用于离线安装 |
| `OBSIDIAN_ASSETS_PATH` | /app/obsidian-app | 解压后的 Obsidian 文件存放位置 |
| `PUID` | 1000 | 写入文件的用户 ID |
| `PGID` | 1000 | 写入文件的组 ID |
| `WS_ORIGINS` | 未设置 | Origin 允许列表（带 scheme），精确匹配浏览器请求 |
| `PROXY_ALLOW_PRIVATE_HOSTS` | 未设置 | 允许跨域代理访问的私有 IP 或 CIDR |
| `AUTO_CREATE_DEFAULT` | false | 启动时若不存在 Vault，自动创建 "My Vault" |
| `WRITE_COALESCE_MS` | 0 | 快速写入的防抖窗口（毫秒），最大 60000 |
| `UV_THREADPOOL_SIZE` | 4 | 并发文件操作数，网络文件系统上的大 Vault 可调高 |

---

## 七、路线图

Ignis 的规划方向包括以下大型工作项：

- **移动端改进与 PWA 支持**：改善小屏幕上的行为，提供可安装的渐进式 Web 应用。
- **Obsidian 版本升级**：在公开版本发布后将固定版本迁移到 1.13.1。
- **ignis-local**：在桌面版 Obsidian 内部运行 Ignis 服务器的变体，无需 Docker。
- **服务端插件安全模型**：为服务端插件运行的后端二进制文件和外部程序提供隔离。
- **认证与访问控制**：内置认证和按用户访问控制。
- 插件兼容性修复、小功能和 bug 修复持续发布。

---

## 八、架构摘要

Ignis 通过用 shim 层替换 Obsidian 的 Electron 后端来在浏览器中运行 Obsidian。该层通过 HTTP 和 WebSocket 将 Node.js 和 Electron API 调用路由到 Express 服务器。

**核心架构组件**：
- **浏览器侧**：未修改的 Obsidian + shim 层（fs、electron 等）+ Bridge。
- **服务器侧**：Express，提供 `/api/fs/*`、`/api/vault/*`、`/api/plugins/*`、`/api/ext/:plugin/*` 等端点。
- **文件系统**：Vault 存储在服务器的 `vaults/` 目录中。

**加载流程**：服务器提供自己的 `index.html`，启动时读取 Obsidian 的 `index.html` 以发现其所需的脚本列表，然后将该列表作为 JSON 数组嵌入 HTML 中。客户端先加载 shim 加载器和 UI bundle，再动态注入 Obsidian 的脚本。Obsidian 的文件在磁盘上从不修改，在传输中也不转换。

**模块实现**：`fs`/`original-fs` 通过 HTTP 传输 + 客户端元数据缓存 + 50MB LRU 内容缓存实现完整接口；`path` 使用 `path-browserify`；`url` 使用浏览器 URL API 包装器；`crypto` 使用 Web Crypto，并通过 `@noble/hashes` 为 SHA-1/SHA-256/SHA-512/MD5 提供真实摘要。

---

以上内容整合自 Ignis 官方文档站点的各个页面，涵盖 Overview、Requirements、Deploy with Docker、Authentication、Remote access、Hardening、Limitations、Plugin compatibility、Server plugins、Settings、Environment variables、Roadmap 及 ARCHITECTURE.md。镜像构建方案详见 [docker-build.md](./docker-build.md)。