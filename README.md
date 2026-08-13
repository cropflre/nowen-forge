# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.6

V0.6 在 V0.5 一键发布编排器之上，补齐“构建完成”到“最终发给用户的文件”之间的证据链。

```text
Release Plan
   ↓
Workflow Run
   ↓
Workflow Artifact
   ├─ GitHub Artifact ID
   ├─ size / expiresAt
   └─ Actions Artifact SHA256
   ↓
Release Manifest
   ↓
GitHub Release
   ├─ exact Tag
   ├─ Tag Commit SHA
   └─ Commit == Manifest Commit ?
   ↓
Final Release Assets
   ├─ asset id
   ├─ file name / size / content-type
   ├─ GitHub Release Asset SHA256
   └─ source artifact group
```

### 双层制品证据

V0.6 明确区分两种不同文件：

- **Workflow Artifact**：GitHub Actions 在构建阶段上传的 ZIP 容器，digest 是 Actions Artifact 自身的 SHA256。
- **Release Asset**：GitHub Release 最终对用户分发的 `.exe/.dmg/.deb/.AppImage/.msi/...` 文件，每个文件使用 GitHub Release Asset API 返回的官方 SHA256。

两种 digest 不会互相冒充。Forge 会把 Release Asset 作为 Manifest 的**追加式证据**保存，Manifest 原有版本、Commit、Run、Workflow Artifact 等核心快照仍保持不可变。

### Release 精确绑定规则

同步 Release Evidence 时：

1. 按 Manifest 版本匹配同版本 GitHub Release（`v1.2.3` 与 `1.2.3` 归一比较）。
2. 解析 Release Tag 当前实际指向的 Commit。
3. 只有 `Release Tag Commit === Manifest Commit` 才标记为“Tag Commit 精确匹配”。
4. 保存 Release ID / Tag / URL / Draft / Pre-release 状态。
5. 保存每个 Release Asset 的 GitHub Asset ID、文件名、大小、content-type、下载地址和官方 SHA256。
6. 根据文件名/平台把最终文件归到对应 Workflow Artifact 分组；这个分组只表示来源 Job，不把 Artifact ZIP digest 与最终文件 digest 当成同一个 hash。

如果 Manifest 创建时 Release 还没生成，可以在「制品中心」点击**同步 Release**。同步采用 `INSERT OR IGNORE` 追加证据，不覆盖已经记录的历史。

## V0.5：一键发布

```text
项目 + 版本 + 来源 Branch/Tag/Commit
              ↓
           Preflight
              ↓
      锁定 Commit + Tag 冲突保护
              ↓
        创建 / 复用版本 Tag
              ↓
       启动正式发布 Workflow
              ↓
       服务端持续追踪 Run
              ↓
       completed 后自动 Manifest
              ↓
       V0.6 自动尝试 Release Evidence
```

### 发布安全规则

- 版本输入支持 `1.2.3` / `v1.2.3` / `1.2.3-rc.1`，最终统一成 `v*`
- Preflight 把来源 ref 解析并锁定为具体 Commit SHA
- 目标 Tag 已存在但指向其他 Commit 时直接阻止发布
- 已存在且指向同一 Commit 时复用，不移动/覆盖正式 Tag
- 同一项目 + 版本只允许一个发布计划
- 发布计划持久化 SQLite，关闭浏览器不会中断服务端编排

### 4 个项目策略

| 项目 | 策略 |
| --- | --- |
| `nowen-note` | `v*` Tag 自动触发 Desktop + iOS；20 秒未捕获时用同 Tag ref dispatch 兜底 |
| `nowen-video` | `v*` Tag 自动触发 Desktop Release；未捕获时用同 Tag ref dispatch；当前正式矩阵仍以 Windows 为主 |
| `nowen-reader` | 创建 `v*` Tag 后直接以 Tag ref dispatch `build.yml`，满足现有 tag-only Job |
| `NOWEN` | 创建 `v*` Tag 后以该 Tag ref dispatch Docker Workflow；配套 Workflow V0.6 会推 `vX.Y.Z + X.Y.Z + latest + SHA` |

## NOWEN Docker 渠道规则

配套的 `cropflre/NOWEN` Docker Workflow 调整为：

```text
main push
├─ cropflre/nowen:edge
└─ cropflre/nowen:<commit-sha>

Forge release with tag v1.2.3
├─ cropflre/nowen:v1.2.3
├─ cropflre/nowen:1.2.3
├─ cropflre/nowen:latest
└─ cropflre/nowen:<commit-sha>
```

因此普通 main 提交不会再覆盖 stable `latest`；只有正式版本 Tag 发布才提升 `latest`。

## 实时状态

```text
GitHub Webhook ───────┐
                     ├─> Nowen Forge event bus -> SSE -> Browser
GitHub polling ───────┘
```

- `/api/events` SSE
- `/api/webhooks/github` HMAC-SHA256
- `X-GitHub-Delivery` SQLite 幂等去重
- NAS / 局域网无需公网 Webhook，轮询兜底仍可自动刷新
- Release Plan watcher 在服务端持续推进活动发布计划

## 架构

```text
Browser
  │ SSE / REST
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │    ├─ projects / webhook_events
  │    ├─ release_manifests / manifest_artifacts
  │    ├─ manifest_release_bindings / manifest_release_assets
  │    └─ release_plans / release_plan_runs
  │
  ├─ GitHub REST API
  │    ├─ Git refs / tags
  │    ├─ Workflows / Runs / Jobs
  │    ├─ Actions Artifacts + digest
  │    └─ Releases / Release Assets + digest
  │
  ├─ Release Plan watcher
  ├─ Artifact download proxy
  ├─ GitHub Webhook + polling fallback + SSE
  └─ Release adapters
       ├─ Docker Hub
       ├─ Gitee workflow
       └─ TestFlight workflow
```

V0.6 仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。

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

推荐 Fine-grained PAT 只授权 Nowen 相关仓库：

```text
Repository permissions
- Contents: Read and write   # 创建版本 Tag / 读取 Release
- Actions: Read and write    # workflow_dispatch / cancel / rerun / Artifact
```

```bash
GITHUB_TOKEN=github_pat_xxx
GITHUB_WEBHOOK_SECRET=your-long-random-secret   # 可选
RUN_POLL_INTERVAL_MS=12000                      # 可选
PORT=3001
HOST=0.0.0.0
```

Token 只存在服务端环境变量，不下发浏览器，也不写入 SQLite。

## 当前页面

- 仪表盘
- 项目 / 流水线
- 构建记录
- 一键发布
- 发布中心
- **制品中心：Workflow Artifact + Final Release Asset**
- 设置

## 下一阶段

1. Gitee API / App Store Connect API：获取平台侧最终发布状态，而不是只看同步 Workflow
2. 发布失败后的渠道级重试 / Promote
3. Release Asset 与 Gitee 镜像文件的一致性校验
4. 可视化 Pipeline AST
5. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
