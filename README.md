# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.4

### 流水线运行

- 预置 `nowen-note`、`nowen-video`、`nowen-reader`、`NOWEN`
- 自动发现 GitHub Actions Workflows
- 自动解析 `workflow_dispatch.inputs` 并生成运行表单
- Branch / Tag 选择、Tag-only 风险提示
- 取消运行、重跑失败 Job、查看 Job / Step / Artifact
- Artifact 直接展示 GitHub 官方 `sha256` digest

### Release Center

统一查看：

- GitHub Release
- Docker Hub
- `nowen-note` Gitee Release 同步流水线
- `nowen-note` TestFlight 流水线

渠道独立判断，不把普通 CI success 当作正式发布完成。

### 实时状态

```text
GitHub Webhook ───────┐
                     ├─> Nowen Forge event bus -> SSE -> Browser
GitHub polling ───────┘
```

- `/api/events` SSE
- `/api/webhooks/github` HMAC-SHA256 签名校验
- `X-GitHub-Delivery` SQLite 幂等去重
- NAS / 局域网无需公网 Webhook，轮询兜底仍可自动刷新

### V0.4：Release Manifest + 制品中心

V0.4 把一次已经完成的 Workflow Run 固化成**不可变 Manifest 快照**：

```text
Nowen Note v1.4.10
├─ Workflow Run #79
├─ Commit f4a955beeedb...
├─ Conclusion failure
├─ Artifacts
│  ├─ nowen-note-linux
│  │  ├─ size
│  │  ├─ expiresAt
│  │  └─ sha256:...
│  └─ nowen-note-mac
│     └─ sha256:...
└─ Channel Snapshot
   ├─ GitHub Release
   ├─ Docker Hub
   ├─ Gitee
   └─ TestFlight
```

核心规则：

- 只有 `completed` 的 Workflow Run 才能固化 Manifest
- **失败的已完成 Run 也允许固化**，用于保留部分成功 Artifact 与失败证据
- Tag Run 自动用 Tag 作为版本；普通构建使用 `build-<runNumber>`
- 同一个 `project + run + version` 只生成一次，不覆盖历史快照
- SQLite 只保存 Manifest 元数据、SHA256、大小、过期时间和渠道快照，不保存大文件
- SHA256 优先直接使用 GitHub Actions Artifact API 提供的官方 `digest`
- Artifact 下载走 Forge 服务端代理，浏览器拿不到 `GITHUB_TOKEN`

## 架构

```text
Browser
  │ SSE / REST
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │    ├─ projects
  │    ├─ webhook_events
  │    ├─ release_manifests
  │    └─ manifest_artifacts
  │
  ├─ GitHub REST API
  │    ├─ Workflows / Runs / Jobs
  │    ├─ Artifacts + digest
  │    └─ Releases
  │
  ├─ Artifact download proxy
  ├─ GitHub Webhook + polling fallback + SSE
  └─ Release adapters
       ├─ Docker Hub
       ├─ Gitee sync workflow
       └─ TestFlight workflow
```

V0.4 仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。

## 本地开发

要求 Node.js 20+。

```bash
cp .env.example .env
# 编辑 .env，至少填入 GITHUB_TOKEN
npm install
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

访问 `http://localhost:3001`。

数据保存在 `./data/nowen-forge.db`。

## 环境变量

```bash
GITHUB_TOKEN=github_pat_xxx

# 可选：Forge 有公网 HTTPS 地址时配置
GITHUB_WEBHOOK_SECRET=your-long-random-secret

# 可选：轮询兜底间隔，单位毫秒，最小 5000
RUN_POLL_INTERVAL_MS=12000

PORT=3001
HOST=0.0.0.0
```

`GITHUB_TOKEN` 只存在服务端环境变量，不会下发浏览器，也不会写入 SQLite。

Artifact 下载代理需要 `GITHUB_TOKEN`，因为 GitHub Actions Artifact 下载接口需要鉴权。

## 可选：配置 GitHub Webhook

```text
Payload URL: https://你的域名/api/webhooks/github
Content type: application/json
Secret: 与 GITHUB_WEBHOOK_SECRET 完全一致
```

建议发送：Workflow runs、Workflow jobs、Releases、Pushes。

如果 Forge 只部署在 NAS / 局域网，可以完全不配置 Webhook。

## 当前已识别的发布链路

| 项目 | 主要发布链路 |
| --- | --- |
| `nowen-note` | Desktop GitHub Release、Docker Hub、Gitee、iOS/TestFlight |
| `nowen-video` | Desktop GitHub Release |
| `nowen-reader` | Go binary、GitHub Release、Docker Hub |
| `NOWEN` | Docker Hub multi-arch |

`nowen-reader/.github/workflows/build.yml` 当前仅声明 `workflow_dispatch`，但 build/docker/release Jobs 又要求 `refs/tags/v*`。Forge 会提示这个风险。

## 下一阶段

1. 一键「发布版本」：输入版本 → 创建 Tag → 构建 → Manifest → Release → 渠道同步
2. Release Manifest 与 GitHub Release Asset 的精确绑定
3. Gitee API / App Store Connect API 最终平台状态
4. 可视化 Pipeline AST
5. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
