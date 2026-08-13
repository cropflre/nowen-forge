# Nowen Forge

Nowen 系列统一构建、发布与 CI/CD 控制台。第一阶段参考流水线平台的核心体验，但保持单用户、轻部署：**Nowen Forge 是控制面，GitHub Actions 是执行面**。

## V0.1 已实现

- 预置 `nowen-note`、`nowen-video`、`nowen-reader`、`NOWEN`
- 自动读取各仓库 GitHub Actions workflows
- 推荐现有正式发布流水线并置顶
- 读取分支与默认分支
- 手动 `workflow_dispatch`，支持 ref / tag 和 JSON inputs
- 跨项目 Dashboard、最近构建、成功率和运行状态
- 单项目构建历史
- Workflow Run 的 Jobs / Steps / Artifacts 详情
- 失败 Job 重跑、运行中任务取消
- SQLite 本地数据库，只记录平台侧配置与发起记录
- React + Vite 管理端、Fastify API
- 单 Docker 容器部署

## 架构

```text
Browser
  │
  ▼
Nowen Forge (React + Fastify)
  ├─ SQLite /app/data/nowen-forge.db
  │
  └─ GitHub REST API
       ├─ cropflre/nowen-note      → GitHub Actions
       ├─ cropflre/nowen-video     → GitHub Actions
       ├─ cropflre/nowen-reader    → GitHub Actions
       └─ cropflre/NOWEN           → GitHub Actions
```

V0.1 不自建 Runner、不引入 PostgreSQL / Redis / MinIO，避免给个人发布平台增加无意义的运维复杂度。

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

推荐创建 Fine-grained personal access token，只授权需要管理的 Nowen 仓库。读取公开仓库状态不配置 Token 也能工作，但以下操作需要 GitHub Actions 写权限：

- 启动 `workflow_dispatch`
- 取消 Workflow Run
- 重跑失败 Jobs

**Token 只存在服务端环境变量 `GITHUB_TOKEN`，不会下发到浏览器，也不会写入 SQLite。**

## 下一阶段

1. Release Center：统一 GitHub Release / Gitee / DockerHub / TestFlight 状态
2. 自动解析 `workflow_dispatch.inputs`，不再手写 JSON
3. Artifact 下载代理与 SHA256 制品清单
4. Webhook + SSE 实时刷新，替代手动刷新
5. Release Manifest / Build once, promote many
6. 可视化 Pipeline AST；最后再考虑自研 Nowen Runner

## License

License will be added before the first public release.
