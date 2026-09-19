# Ignis CI/CD 工作流

三条 GitHub Actions 流水线：**CI（质量门禁）→ CD 构建镜像（发布）→ CD 部署（上线）**。覆盖从代码提交到生产容器的完整链路。

## 一、流水线总览

```
push / PR ──► CI ──┐
                   │  lint + test + build 产物验证
                   ▼
tag v* ─────────► Build & push image ──► (可选) Deploy to server
                   │  buildx 多架构推送     │  SSH pull + up -d
                   ▼                       ▼
              GHCR / Docker Hub       生产服务器
```

| 工作流 | 文件 | 触发 | 作用 |
|---|---|---|---|
| **CI** | `.github/workflows/ci.yml` | push main / PR | lint、单测、构建产物校验、产物归档 |
| **Build & push image** | `.github/workflows/build-image.yml` | tag `v*` / 手动 | buildx 多架构构建（amd64+arm64）推送 GHCR/Docker Hub |
| **Deploy to server** | `.github/workflows/deploy.yml` | 镜像构建成功后 / 手动 | SSH 到生产机 pull + compose up |

## 二、CI：质量门禁（ci.yml）

每次 push 到 `main` 或 PR 时运行，三个关键步骤：

1. **lint**：`npm run lint`（oxlint 0 警告 + error-leak check）
2. **test**：`npm test`（vitest 全量）
3. **build**：`npm run build`，并断言四个产物存在：
   - `packages/shim/dist/shim-loader.js`
   - `packages/ui/dist/ignis-ui.js`
   - `apps/ignis-server/.../headless-sync/dist/ignis-headless-sync.js`
   - `apps/ignis-server/server/build-info.json`

产物通过 `actions/upload-artifact` 归档 7 天（可下载排查）。

> Windows 注意：vitest 在 Windows 上偶发 `ERR_IPC_CHANNEL_CLOSED`（watcher 测试触发 chokidar 断言），CI 跑在 **ubuntu-latest** 无此问题；若未来要加 Windows 矩阵，测试需逐文件运行或 `--pool=forks`。

## 三、CD：构建并推送镜像（build-image.yml）

**触发方式**：打版本 tag（`git tag v0.8.10 && git push --tags`）或 Actions 页面手动触发（`push` 输入设为 false 则只构建不推送）。

**流程**：

1. `setup-node` + `docker/setup-buildx-action` + `docker/setup-qemu-action`（arm64 需 QEMU，amd64 原生跑）
2. **登录 GHCR**（必做，`GITHUB_TOKEN` 自动注入）→ **可选登录 Docker Hub**（配 `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets 后启用）
3. buildx 缓存恢复（`actions/cache`，加速重复构建）
4. 调用工程自带 `node apps/ignis-server/scripts/build-image.js --push`：
   - 构建 `linux/amd64,linux/arm64` 双架构
   - tag = `package.json` 版本（如 `0.8.10`）+ `latest`
   - 推送 manifest list 到登录的 registry

**多 registry 说明**：脚本默认推 `nobbe/ignis`（Docker Hub）。推 GHCR 需设 `IGNIS_IMAGE` 环境变量（如 `ghcr.io/<org>/ignis`）——本 workflow 的 `env.IMAGE` 当前为 `nobbe/ignis`，改推 GHCR 时同步调整。

## 四、CD：部署到服务器（deploy.yml，可选）

镜像推送成功后自动触发（`workflow_run`），SSH 到生产机：

```bash
cd ~/ignis && docker compose pull && docker compose up -d
docker image prune -f
curl -fsS http://localhost:8080/api/version
```

**前置要求**：
- 生产机已放置 `~/ignis/docker-compose.yml`（用 `apps/ignis-server/examples/production/` 模板）
- 配置 4 个仓库 secrets（Settings → Secrets and variables → Actions）：

| Secret | 说明 |
|---|---|
| `DEPLOY_HOST` | 服务器地址，如 `obsidian.example.com` |
| `DEPLOY_USER` | SSH 用户，如 `deploy` |
| `DEPLOY_KEY` | SSH 私钥全文（公钥加入服务器 `~/.ssh/authorized_keys`） |
| `DEPLOY_PORT` | SSH 端口（默认 22） |

> 若用 GHCR 镜像，生产机需先 `docker login ghcr.io`（或用 `GITHUB_TOKEN` 生成的只读 PAT）。

## 五、端到端发布流程（示例）

```bash
# 1. 版本号（package.json 已是 0.8.10，直接打 tag）
git tag v0.8.10
git push origin v0.8.10
#    └─ CI 先跑（同一 commit 的 push/PR 已验过质量）
#    └─ Build & push image 触发：amd64+arm64 推送

# 2. 服务器（可选：若配置了 deploy.yml 则自动完成）
ssh deploy@obsidian.example.com
cd ~/ignis
docker compose pull
docker compose up -d
curl http://localhost:8080/api/version
# → {"version":"0.8.10",...,"obsidianVersion":"1.13.7"}
```

## 六、版本与镜像命名约定

| 来源 | 值 |
|---|---|
| 版本来源 | `package.json` 的 `version`（必须是纯 `X.Y.Z`，`build-image.js` 会拒绝其他格式） |
| 镜像 tag | `0.8.10`（版本）+ `latest`（最新） |
| 构建戳 | `IGNIS_BUILD` 环境变量注入 `build-info.json` → `0.8.10+<hash>` |
| 触发 tag | `v0.8.10`（带 `v` 前缀，workflow 匹配 `v*`） |

## 七、常见问题

- **`--push` 被拒**：未登录 registry。检查 GHCR login step 是否跳过（`startsWith(github.ref, 'refs/tags/')` 需 tag 触发）。
- **arm64 构建慢**：QEMU 模拟开销；只部署 amd64 时可在 `build-image.js` 的 `PLATFORMS` 去掉 `linux/arm64`。
- **部署 workflow 未触发**：`workflow_run` 需镜像 workflow 在**同一默认分支**完成；手动跑 deploy 时用 `workflow_dispatch`。
- **健康检查一直 Unhealthy**：首启下载 Obsidian 需 1-2 分钟，`start_period: 180s` 已覆盖；仍失败检查 `/api/version` 响应与 `OBSIDIAN_VERSION` 是否可达。
