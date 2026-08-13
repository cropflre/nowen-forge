# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。面向个人维护场景保持轻量：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.2

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

> Gitee / TestFlight V0.2 展示的是负责发布它们的 GitHub Actions 流水线状态；后续版本可再接 Gitee API / App Store Connect API 获取平台侧最终状态。

## 架构

```text
Browser
  │
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │
  ├─ GitHub REST API
  │    ├─ Workflows / Runs / Jobs / Artifacts
  │    ├─ Workflow YAML
  │    └─ GitHub Releases
  │
  └─ Release adapters
       ├─ Docker Hub public tags
       ├─ Gitee sync workflow
       └─ TestFlight workflow
```

V0.2 仍然不自建 Runner，也不引入 PostgreSQL / Redis / MinIO。真正的 Windows、macOS、Linux、iOS、Docker 构建继续交给 GitHub Actions。

## 本地开发

要求 Node.js 20+。

```bash
cp .env.example .env
# 编辑 .env，填入 GITHUB_TOKEN
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

## GitHub Token

推荐创建 Fine-grained personal access token，只授权需要管理的 Nowen 仓库。

读取公开仓库、Release 与 Workflow 状态在 GitHub 限流允许时可以匿名工作；以下操作需要服务端配置 `GITHUB_TOKEN`，并拥有对应仓库的 Actions 写权限：

- 启动 `workflow_dispatch`
- 取消 Workflow Run
- 重跑失败 Jobs

**Token 只存在服务端环境变量，不会下发浏览器，也不会写入 SQLite。**

## 当前已识别的发布链路

| 项目 | 主要发布链路 |
| --- | --- |
| `nowen-note` | Desktop GitHub Release、Docker Hub、Gitee 同步、iOS/TestFlight |
| `nowen-video` | Desktop GitHub Release |
| `nowen-reader` | Go binary、GitHub Release、Docker Hub |
| `NOWEN` | Docker Hub multi-arch |

`nowen-reader/.github/workflows/build.yml` 当前仅声明 `workflow_dispatch`，但 build/docker/release Jobs 又要求 `refs/tags/v*`。Nowen Forge 会在运行前对这类 Tag-only 条件给出提示；建议后续单独修正该项目的发版 Workflow。

## 下一阶段

1. GitHub Webhook + SSE，构建状态实时推送
2. Release Manifest：固定 version / commit / artifact SHA256 / channel
3. Artifact 下载代理与 SHA256 制品清单
4. Gitee API / App Store Connect API 最终发布状态
5. 一键“发布版本”：自动创建 Tag → 构建 → Release → 镜像同步
6. 可视化 Pipeline AST
7. 最后再评估自研 Nowen Runner

## License

License will be added before the first public release.
