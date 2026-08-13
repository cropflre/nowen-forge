import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Database, Github, PackageCheck, Radio, Rocket, RotateCcw, Server, ShieldCheck, Webhook } from 'lucide-react';
import { api } from '../api';
import GitHubAuthControl from '../components/GitHubAuthControl';

type Health = {
  ok: boolean;
  githubConfigured: boolean;
  version?: string;
  realtime?: { sse: boolean; webhookConfigured: boolean; pollIntervalMs: number };
  manifests?: { immutable: boolean; githubArtifactDigest: boolean; githubReleaseAssetDigest?: boolean; appendOnlyReleaseEvidence?: boolean };
  releaseOrchestrator?: { enabled: boolean; persistent: boolean; tagPreflight: boolean };
  releaseRecovery?: { persistent: boolean; appendOnlyAttempts: boolean; failedJobsRetry: boolean; channelRetry: boolean };
  platformVerification?: {
    giteeConfigured: boolean;
    appStoreConnectConfigured: boolean;
    workflowFallbackAsSuccess: boolean;
  };
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false, githubConfigured: false })); }, []);
  const webhookUrl = useMemo(() => `${window.location.origin}/api/webhooks/github`, []);
  const pollSeconds = health?.realtime ? Math.round(health.realtime.pollIntervalMs / 1000) : null;

  return <section><div className="page-head"><div><span className="eyebrow">SETTINGS</span><h1>设置</h1><p>Nowen Forge {health?.version || 'V0.8'} · GitHub 优先使用 OAuth 登录，平台凭证仍只保存在服务端</p></div></div>
    <div className="settings-grid">
      <div className="setting-card"><Github /><div><h3>GitHub 登录</h3><p>推荐直接登录 GitHub。浏览器 OAuth 可一键跳转授权；localhost / NAS / 自部署也可使用 Device Flow。GITHUB_TOKEN 仅作为无人值守部署兜底。</p><GitHubAuthControl /></div></div>
      <div className="setting-card"><RotateCcw /><div><h3>发布恢复</h3><p>失败 Workflow 优先只重跑失败 Job；Gitee / TestFlight / Docker 可独立恢复。恢复记录追加写入 SQLite，并由服务端持续追踪。</p>{health?.releaseRecovery?.persistent && health?.releaseRecovery?.channelRetry ? <span className="setting-ok"><CheckCircle2 size={15} />V0.8 恢复引擎已启用</span> : <span className="setting-warn"><CircleAlert size={15} />恢复引擎状态未知</span>}</div></div>
      <div className="setting-card"><ShieldCheck /><div><h3>Gitee 平台验证</h3><p>直接读取 Gitee 同版本 Release 与附件列表，并和 GitHub 应同步的小文件逐个对比。</p>{health?.platformVerification?.giteeConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Gitee API 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />缺少 GITEE_TOKEN / OWNER / REPO</span>}</div></div>
      <div className="setting-card"><ShieldCheck /><div><h3>TestFlight 平台验证</h3><p>通过 App Store Connect API 按 Bundle ID + 版本读取真实 Build、Processing State 与 Beta State。</p>{health?.platformVerification?.appStoreConnectConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />App Store Connect 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />缺少 App Store Connect API Key</span>}</div></div>
      <div className="setting-card"><Rocket /><div><h3>发布编排器</h3><p>Preflight 锁定 Commit、创建版本 Tag、跟踪正式 Workflow，并在服务端持续推进，不依赖浏览器保持打开。</p>{health?.releaseOrchestrator?.persistent ? <span className="setting-ok"><CheckCircle2 size={15} />持久编排已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><PackageCheck /><div><h3>Release Evidence</h3><p>Manifest 核心快照保持不可变；GitHub Release 与最终 Asset 作为追加式证据保存，恢复动作也不会覆盖原发布证据。</p>{health?.manifests?.githubReleaseAssetDigest ? <span className="setting-ok"><CheckCircle2 size={15} />最终发行证据已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><Radio /><div><h3>SSE 实时通道</h3><p>浏览器与 Nowen Forge 服务端保持长连接，构建/发布/恢复事件到达后页面自动刷新。</p>{health?.realtime?.sse ? <span className="setting-ok"><CheckCircle2 size={15} />已启用</span> : <span className="setting-warn"><CircleAlert size={15} />不可用</span>}</div></div>
      <div className="setting-card"><Webhook /><div><h3>GitHub Webhook</h3><p>可选的秒级事件源。内网/NAS 无公网回调时可以不配置，系统会自动使用轮询兜底。</p>{health?.realtime?.webhookConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Secret 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置，当前使用轮询兜底</span>}</div></div>
      <div className="setting-card"><Database /><div><h3>SQLite</h3><p>保存项目、Webhook 幂等、Manifest、Release Evidence、发布计划与 Recovery Attempt；GitHub OAuth Token 仅保存在服务端 DATA_DIR，不下发到前端。</p><span className="setting-ok"><CheckCircle2 size={15} />本地单用户模式</span></div></div>
      <div className="setting-card"><Server /><div><h3>执行引擎</h3><p>不自建 Runner，Windows / macOS / Linux / iOS / Docker 构建和失败节点重试继续交给 GitHub Actions。</p><span className="setting-ok"><CheckCircle2 size={15} />GitHub Actions</span></div></div>
      <div className="setting-card"><Radio /><div><h3>GitHub API 缓存</h3><p>仓库信息、分支、Workflow、Release 与 Runs 在服务端按不同 TTL 去重缓存；匿名模式会自动使用更长缓存，避免 60 次/小时额度被后台轮询打满。</p>{health?.githubConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />认证高速模式 · 轮询约 {pollSeconds ?? 12}s</span> : <span className="setting-warn"><CircleAlert size={15} />匿名保护模式</span>}</div></div>
      <div className="setting-card"><Radio /><div><h3>验证原则</h3><p>平台渠道只认目标平台真实状态；恢复 Workflow 成功也不会自动冒充 Gitee / TestFlight 已最终发布。</p>{health?.platformVerification?.workflowFallbackAsSuccess === false ? <span className="setting-ok"><CheckCircle2 size={15} />严格平台证据模式</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
    </div>

    <div className="panel docs"><h2>GitHub OAuth 配置</h2><pre>{`# 推荐：浏览器一键 OAuth 登录\nGITHUB_OAUTH_CLIENT_ID=Ov23li_xxx\nGITHUB_OAUTH_CLIENT_SECRET=xxx\n# 可选；反向代理 / NAS 有固定域名时填写\n# GITHUB_OAUTH_CALLBACK_URL=https://forge.example.com/api/auth/github/callback\n\n# 如果只配置 Client ID\n# Forge 自动使用 GitHub Device Flow，不需要 Client Secret\n\n# 可选：无人值守服务器兜底\n# GITHUB_TOKEN=github_pat_xxx`}</pre></div>
    <div className="panel docs"><h2>V0.8 发布恢复</h2><pre>{`失败核心 Workflow\n→ 优先 rerun failed jobs\n→ 被取消的 Run 才 rerun whole workflow\n\n渠道恢复\nGitee      → sync-gitee-release.yml(tag)\nTestFlight → ios-release.yml(tag, upload=true)\nDocker     → 项目对应 Docker / Release Workflow\n\n所有恢复动作\n→ release_recovery_attempts\n→ 服务端 watcher 持续追踪\n→ 原 Manifest / Run 历史不删除`}</pre></div>
    <div className="panel docs"><h2>最终平台验证配置</h2><pre>{`# Gitee\nGITEE_TOKEN=xxx\nGITEE_OWNER=cropflre\nGITEE_REPO=nowen-note\n\n# App Store Connect Team API Key\nAPPSTORE_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\nAPPSTORE_API_KEY_ID=XXXXXXXXXX\nAPPSTORE_API_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\nAPPSTORE_BUNDLE_ID=com.nowen.note`}</pre></div>
    <div className="panel docs"><h2>基础配置</h2><pre>{`# 本地开发：根目录执行 npm run dev\n# Web  http://localhost:18666\n# API  http://localhost:18667\n\n# 根目录 .env 会自动加载\nGITHUB_OAUTH_CLIENT_ID=\nGITHUB_OAUTH_CLIENT_SECRET=\nGITHUB_WEBHOOK_SECRET=可选\nRUN_POLL_INTERVAL_MS=12000\nPORT=18667\n\n# Docker\ndocker compose up -d --build`}</pre></div>
    <div className="panel docs"><h2>可选：GitHub Webhook</h2><p className="muted">只有 Nowen Forge 有 GitHub 可访问的 HTTPS 地址时才需要配置。没有公网地址可以跳过。</p><pre>{`Payload URL\n${webhookUrl}\n\nContent type\napplication/json\n\nSecret\n与 GITHUB_WEBHOOK_SECRET 完全一致\n\n推荐事件\nWorkflow runs / Workflow jobs / Releases / Pushes`}</pre></div>
  </section>;
}
