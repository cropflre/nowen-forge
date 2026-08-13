# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.5

V0.5 在 V0.4 的 Release Manifest / 制品中心之上，新增真正的**一键发布编排器**。

```text
项目 + 版本 + 来源 Branch/Tag/Commit
              │
              ▼
           Preflight
              │
              ├─ 校验 SemVer
              ├─ 解析并锁定 Commit SHA
              ├─ 检查目标 Tag 是否冲突
              ├─ 检查正式 Workflow 是否存在
              └─ 检查 workflow_dispatch 兜底能力
              │
              ▼
        创建 / 复用版本 Tag
              │
              ▼
       启动正式发布 Workflow
              │
              ├─ Tag 自动触发优先
              └─ workflow_dispatch(tag) 兜底
              │
              ▼
         服务端持续追踪 Run
              │
              ▼
       completed 后自动固化 Manifest
```

### 发布安全规则

- 版本输入支持 `1.2.3` / `v1.2.3` / `1.2.3-rc.1`，最终统一成 `v*`
- 点击发布前必须先执行 Preflight
- Preflight 会把来源 Branch / Tag / Commit **解析并锁定到具体 Commit SHA**
- 如果目标版本 Tag 已存在并指向其他 Commit，Forge 会直接阻止发布
- 如果 Tag 已存在且指向同一个 Commit，可以复用 Tag，不会移动或覆盖它
- 同一个项目 + 版本只保留一个发布计划，防止重复创建正式版本
- 发布计划持久化到 SQLite，关闭浏览器不会中断服务端编排

### 当前 4 个项目的真实策略

| 项目 | V0.5 策略 |
| --- | --- |
| `nowen-note` | 创建 `v*` Tag；优先捕获 Tag 自动触发的 Desktop + iOS Workflow，未触发则分别以 Tag ref dispatch，Desktop 使用 `publish=always`，iOS 使用 `upload=true` |
| `nowen-video` | 创建 `v*` Tag；优先捕获 Tag Release，未触发则用 Tag ref dispatch `release-desktop.yml` |
| `nowen-reader` | 创建 `v*` Tag 后直接以该 Tag 作为 `workflow_dispatch.ref` 启动 `build.yml`，从而满足现有 tag-only Job 条件 |
| `NOWEN` | 创建版本 Tag 后以该 Tag ref dispatch Docker Workflow；当前仓库仍只推 `latest + commit SHA`，不会把版本号作为 Docker Tag |

### 为什么还有 dispatch 兜底

`nowen-note` / `nowen-video` 的现有正式 Workflow 同时支持 Tag 与 `workflow_dispatch`。Forge 创建 Tag 后会先等待短暂窗口，捕获可能由 Tag 产生的正式 Run；若没有捕获到，就以**同一个 Tag**作为 `workflow_dispatch.ref` 手动触发，避免发布计划卡死。

### 发布计划状态

```text
PREPARING
    ↓
WAITING_RUNS
    ↓
RUNNING
    ↓
SUCCEEDED / PARTIAL / FAILED
```

每个发布计划都会记录：

- 项目
- 版本 / Tag
- 来源 ref
- 锁定 Commit SHA
- Workflow 角色和路径
- 触发来源：Tag 自动 / Forge 手动 / Forge 兜底
- Workflow Run ID / Run Number
- conclusion
- 自动生成的 Manifest ID

## V0.4：Release Manifest + 制品中心

完成的 Workflow Run 可以固化成不可变 Manifest：

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

- 只有 `completed` Run 才能固化
- 失败 Run 也允许固化，保留部分成功 Artifact 与失败证据
- SQLite 只保存 Manifest 元数据 / SHA256 / 大小 / 过期时间 / 渠道快照，不保存大文件
- Artifact SHA256 优先使用 GitHub Actions API 返回的官方 `digest`
- Artifact 下载走 Forge 服务端代理，浏览器拿不到 `GITHUB_TOKEN`

## 实时状态

```text
GitHub Webhook ───────┐
                     ├─> Nowen Forge event bus -> SSE -> Browser
GitHub polling ───────┘
```

- `/api/events` SSE
- `/api/webhooks/github` HMAC-SHA256 签名校验
- `X-GitHub-Delivery` SQLite 幂等去重
- NAS / 局域网无需公网 Webhook，轮询兜底仍可自动刷新
- V0.5 另有服务端 Release Plan watcher，活动发布计划不依赖浏览器保持打开

## 架构

```text
Browser
  │ SSE / REST
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │    ├─ projects
  │    ├─ webhook_events
  │    ├─ release_manifests / manifest_artifacts
  │    └─ release_plans / release_plan_runs
  │
  ├─ GitHub REST API
  │    ├─ Git refs / tags
  │    ├─ Workflows / Runs / Jobs
  │    ├─ Artifacts + digest
  │    └─ Releases
  │
  ├─ Release Plan watcher
  ├─ Artifact download proxy
  ├─ GitHub Webhook + polling fallback + SSE
  └─ Release adapters
       ├─ Docker Hub
       ├─ Gitee sync workflow
       └─ TestFlight workflow
```

V0.5 仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。

## 本地开发

要求 Node.js 20+。

```bash
cp .env.example .env
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

访问 `http://localhost:3001`，SQLite 数据保存在 `./data/nowen-forge.db`。

## GitHub Token 权限

V0.5 一键发布需要服务端 `GITHUB_TOKEN`。推荐 Fine-grained PAT 只授权 Nowen 相关仓库：

```text
Repository permissions
- Contents: Read and write   # 创建版本 Tag
- Actions: Read and write    # workflow_dispatch / cancel / rerun
```

```bash
GITHUB_TOKEN=github_pat_xxx

# 可选：Forge 有公网 HTTPS 地址时配置
GITHUB_WEBHOOK_SECRET=your-long-random-secret

# 可选：普通 GitHub 状态轮询间隔，单位毫秒
RUN_POLL_INTERVAL_MS=12000

PORT=3001
HOST=0.0.0.0
```

`GITHUB_TOKEN` 只存在服务端环境变量，不会下发浏览器，也不会写入 SQLite。

## 可选：GitHub Webhook

```text
Payload URL: https://你的域名/api/webhooks/github
Content type: application/json
Secret: 与 GITHUB_WEBHOOK_SECRET 完全一致
```

推荐事件：Workflow runs、Workflow jobs、Releases、Pushes。

## 当前主要页面

- 仪表盘
- 项目 / 流水线
- 构建记录
- **一键发布**
- 发布中心
- 制品中心
- 设置

## 下一阶段

1. Release Manifest 与 GitHub Release Asset 精确绑定，形成最终发行制品清单
2. 修正 `NOWEN` Docker Workflow，使正式版本同时推 `vX.Y.Z / X.Y.Z / latest`
3. Gitee API / App Store Connect API 最终平台状态
4. 发布回滚 / 重试策略
5. 可视化 Pipeline AST
6. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
