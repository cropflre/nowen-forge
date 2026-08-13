# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.8：发布恢复 / 渠道重试

V0.8 解决“一次正式发布只有部分节点失败时，不应该重新全量发版”的问题。

```text
Release Plan v1.4.11
├─ Desktop Release       ✅
├─ iOS / TestFlight      ❌
├─ GitHub Release        ✅
├─ Gitee                 ❌
└─ Docker                ✅
          ↓
      Release Recovery
          ├─ 重试失败 Workflow
          ├─ 重试 Gitee
          ├─ 重试 TestFlight
          ├─ 重试 Docker
          └─ 重新检查平台状态
```

### 核心恢复规则

- 失败 Workflow 有 GitHub Run 时优先调用 **rerun failed jobs**，只重跑失败 Job。
- 被取消的 Workflow 才使用整条 rerun。
- dispatch 阶段失败且还没有 Run 时，重新以原版本 Tag dispatch 同一 Workflow。
- Gitee 恢复只触发 `sync-gitee-release.yml(tag)`。
- TestFlight 恢复只触发 `ios-release.yml(tag, upload=true)`；如果 App Store Connect 仍是 `PROCESSING`，Forge 只允许重新检查，不重复上传。
- Docker 恢复使用项目真实发布 Workflow：`NOWEN/docker-publish.yml`、`nowen-reader/build.yml`。
- 原 Release Plan / Run / Manifest 不删除、不覆盖；每次恢复写入独立 `release_recovery_attempts`。
- Recovery watcher 在服务端运行，关闭浏览器不会中断恢复跟踪。

### 指定版本精确验证

恢复 `v1.4.11` 时不会读取“当前最新版本”的渠道状态。Forge 会按当前 Release Plan 版本精确检查：

```text
v1.4.11
├─ GitHub Release v1.4.11
├─ Docker Hub v1.4.11 / 1.4.11
├─ Gitee Release v1.4.11
└─ TestFlight 1.4.11 Build
```

因此旧版本恢复不会被更新版本的发布状态误判。

## V0.7：最终平台验证

V0.7 将 Gitee / TestFlight 从“Workflow 成功”升级成“平台侧真实确认”。

- Gitee：直接调用 Gitee API，确认同 Tag Release 与附件。
- TestFlight：通过 App Store Connect API + ES256 JWT，按 Bundle ID + 版本读取真实 Build。
- 区分 TestFlight `PROCESSING / VALID / FAILED / INVALID`。
- 未配置平台凭证时明确显示“平台未配置”，不会把 GitHub Actions 成功当成最终发布成功。

### 平台验证环境变量

```bash
# Gitee
GITEE_TOKEN=
GITEE_OWNER=cropflre
GITEE_REPO=nowen-note

# App Store Connect Team API Key
APPSTORE_ISSUER_ID=
APPSTORE_API_KEY_ID=
APPSTORE_API_PRIVATE_KEY=
APPSTORE_BUNDLE_ID=com.nowen.note
```

## V0.6：Release Evidence

Manifest 保存两层不同证据：

```text
Workflow Artifact
├─ GitHub Artifact ID
├─ size / expiresAt
└─ Actions Artifact SHA256

Final GitHub Release Asset
├─ GitHub Asset ID
├─ file name / size / content-type
├─ Release Asset SHA256
└─ Release Tag Commit == Manifest Commit ?
```

Actions Artifact digest 与最终 Release Asset digest 不会混用。Release Evidence 采用追加式保存，Manifest 核心快照保持不可变。

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
```

当前项目策略：

| 项目 | 策略 |
| --- | --- |
| `nowen-note` | `v*` Tag 自动触发 Desktop + iOS；未捕获时用同 Tag ref dispatch 兜底 |
| `nowen-video` | `v*` Tag 自动触发 Desktop Release；当前正式矩阵主要为 Windows |
| `nowen-reader` | 创建 `v*` Tag 后以 Tag ref dispatch `build.yml`，满足 tag-only Job |
| `NOWEN` | 创建 `v*` Tag 后以该 Tag ref dispatch Docker Workflow |

## NOWEN Docker 渠道

```text
main push
├─ cropflre/nowen:edge
└─ cropflre/nowen:<commit-sha>

Forge release v1.2.3
├─ cropflre/nowen:v1.2.3
├─ cropflre/nowen:1.2.3
├─ cropflre/nowen:latest
└─ cropflre/nowen:<commit-sha>
```

普通 main 提交不会覆盖 stable `latest`；只有正式版本 Tag 发布才提升 `latest`。

## 实时状态

```text
GitHub Webhook ───────┐
                     ├─> Nowen Forge event bus -> SSE -> Browser
GitHub polling ───────┘

Release Plan watcher ───────┐
Release Recovery watcher ───┴─> SQLite 持久状态
```

- `/api/events` SSE
- `/api/webhooks/github` HMAC-SHA256
- `X-GitHub-Delivery` SQLite 幂等去重
- NAS / 局域网无需公网 Webhook，轮询兜底仍可自动刷新

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
  │    ├─ release_plans / release_plan_runs
  │    └─ release_recovery_attempts
  │
  ├─ GitHub REST API
  │    ├─ Git refs / tags
  │    ├─ Workflows / Runs / Jobs / rerun failed jobs
  │    ├─ Actions Artifacts + digest
  │    └─ Releases / Release Assets + digest
  │
  ├─ Release Plan watcher
  ├─ Release Recovery watcher
  ├─ Artifact download proxy
  ├─ GitHub Webhook + polling fallback + SSE
  └─ Platform adapters
       ├─ Docker Hub
       ├─ Gitee API
       └─ App Store Connect API
```

仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。

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
- Contents: Read and write
- Actions: Read and write
```

`Actions: write` 同时用于 workflow_dispatch、cancel、rerun 和 V0.8 的 failed-jobs recovery。

```bash
GITHUB_TOKEN=github_pat_xxx
GITHUB_WEBHOOK_SECRET=your-long-random-secret   # 可选
RUN_POLL_INTERVAL_MS=12000                      # 可选
PORT=3001
HOST=0.0.0.0
```

Token / Gitee Token / App Store Connect Private Key 只存在服务端环境变量，不下发浏览器，也不写入 SQLite。

## 当前页面

- 仪表盘
- 项目 / 流水线
- 构建记录
- **一键发布 + 发布恢复**
- 发布中心
- 制品中心
- 设置

## 下一阶段

1. Recovery Attempt 与 Manifest 增加 GitHub `run_attempt` 级证据关联
2. Gitee 最终附件增加 SHA256 一致性校验（平台能力允许时）
3. Docker Manifest Digest / amd64 / arm64 平台级证据
4. Release Promote：RC → Stable
5. 可视化 Pipeline AST
6. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
