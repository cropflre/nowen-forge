# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.3

### 流水线运行

- 预置 `nowen-note`、`nowen-video`、`nowen-reader`、`NOWEN`
- 自动发现各仓库 GitHub Actions Workflows
- 自动读取 `.github/workflows/*.yml` 的 `workflow_dispatch.inputs`
- `choice / boolean / number / string / environment` 自动生成表单，不再手写 JSON
- 自动读取 Branch 与 Tag，作为运行 ref 候选
- 检测常见 Tag-only Job 条件并在运行前提示风险
- 服务端再次校验 required / unknown inputs
- 支持取消运行、重跑失败 Jobs
- 查看 Workflow Run 的 Jobs / Steps / Artifacts

### Release Center

统一聚合 Nowen 系列发布状态：

- **GitHub Release**：读取真实 Release、Draft / Pre-release、附件数量
- **Docker Hub**：读取真实公开镜像 Tag 和最近更新时间
- **Gitee Release**：`nowen-note` 读取 GitHub → Gitee 同步流水线最近状态
- **TestFlight**：`nowen-note` 读取 iOS Build & TestFlight 最近状态
- 跨项目汇总最近 GitHub Releases
- 渠道状态独立判断，避免“CI 成功 = 已发布”的错误认知

### 实时状态

V0.3 新增三层实时链路：

```text
GitHub Actions / Release
        │
        ├─ GitHub Webhook ───────────────┐
        │                                │
        └─ Server polling fallback ──────┤
                                         ▼
                                Nowen Forge event bus
                                         │
                                         ▼
                                      SSE
                                         │
                                         ▼
                                    Browser UI
```

- 浏览器通过 `/api/events` 建立 SSE 长连接
- GitHub Webhook `/api/webhooks/github` 支持 HMAC-SHA256 签名校验
- 使用 `X-GitHub-Delivery` 写入 SQLite 做事件幂等去重
- 没有公网地址时无需 Webhook：服务端主动轮询 GitHub，NAS / 内网部署仍可自动刷新
- 配置 `GITHUB_TOKEN` 时默认每 12 秒轮询；匿名模式默认每 5 分钟，避免撞 GitHub API 限额
- Dashboard、项目构建详情、Release Center 会在事件变化时自动刷新

> Gitee / TestFlight 当前展示的是负责发布它们的 GitHub Actions 流水线状态；后续版本再接 Gitee API / App Store Connect API 获取平台侧最终状态。

## 架构

```text
Browser
  │ SSE
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │    └─ webhook delivery 去重
  │
  ├─ GitHub REST API
  │    ├─ Workflows / Runs / Jobs / Artifacts
  │    ├─ Workflow YAML
  │    └─ GitHub Releases
  │
  ├─ Realtime
  │    ├─ GitHub Webhook
  │    ├─ GitHub polling fallback
  │    └─ SSE event stream
  │
  └─ Release adapters
       ├─ Docker Hub public tags
       ├─ Gitee sync workflow
       └─ TestFlight workflow
```

V0.3 仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。真正的 Windows、macOS、Linux、iOS、Docker 构建继续交给 GitHub Actions。

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
# 编辑 .env

docker compose up -d --build
```

访问 `http://localhost:3001`。

数据保存在 `./data/nowen-forge.db`。

## 环境变量

```bash
GITHUB_TOKEN=github_pat_xxx

# 可选：只有 GitHub 能访问 Forge HTTPS 地址时才配置
GITHUB_WEBHOOK_SECRET=your-long-random-secret

# 可选：轮询兜底间隔，单位毫秒，最小 5000
RUN_POLL_INTERVAL_MS=12000

PORT=3001
HOST=0.0.0.0
```

`GITHUB_TOKEN` 只存在服务端环境变量，不会下发浏览器，也不会写入 SQLite。

## 可选：配置 GitHub Webhook

如果 Forge 有 GitHub 可以访问的公网 HTTPS 地址，在 4 个项目的仓库 Webhook 中配置：

```text
Payload URL: https://你的域名/api/webhooks/github
Content type: application/json
Secret: 与 GITHUB_WEBHOOK_SECRET 完全一致
```

建议发送这些事件：

- Workflow runs
- Workflow jobs
- Releases
- Pushes

如果 Forge 只部署在 NAS / 局域网，**可以完全不配置 Webhook**，轮询兜底仍然会触发 SSE 自动更新。

## 当前已识别的发布链路

| 项目 | 主要发布链路 |
| --- | --- |
| `nowen-note` | Desktop GitHub Release、Docker Hub、Gitee 同步、iOS/TestFlight |
| `nowen-video` | Desktop GitHub Release |
| `nowen-reader` | Go binary、GitHub Release、Docker Hub |
| `NOWEN` | Docker Hub multi-arch |

`nowen-reader/.github/workflows/build.yml` 当前仅声明 `workflow_dispatch`，但 build/docker/release Jobs 又要求 `refs/tags/v*`。Nowen Forge 会在运行前对这类 Tag-only 条件给出提示；建议后续单独修正该项目的发版 Workflow。

## 下一阶段

1. Release Manifest：固定 version / commit / artifact SHA256 / channel
2. Artifact 下载代理与 SHA256 制品清单
3. 一键“发布版本”：自动创建 Tag → 构建 → Release → 镜像同步
4. Gitee API / App Store Connect API 最终发布状态
5. 可视化 Pipeline AST
6. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
