import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Database, Github, PackageCheck, Radio, Rocket, Server, ShieldCheck, Webhook } from 'lucide-react';
import { api } from '../api';

type Health = {
  ok: boolean;
  githubConfigured: boolean;
  version?: string;
  realtime?: { sse: boolean; webhookConfigured: boolean; pollIntervalMs: number };
  manifests?: { immutable: boolean; githubArtifactDigest: boolean; githubReleaseAssetDigest?: boolean; appendOnlyReleaseEvidence?: boolean };
  releaseOrchestrator?: { enabled: boolean; persistent: boolean; tagPreflight: boolean };
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

  return <section><div className="page-head"><div><span className="eyebrow">SETTINGS</span><h1>设置</h1><p>Nowen Forge {health?.version || 'V0.7'} · 所有发布平台凭证仅存在服务端环境变量</p></div></div>
    <div className="settings-grid">
      <div className="setting-card"><Github /><div><h3>GitHub Token</h3><p>一键发布需要 Fine-grained PAT 对 Nowen 仓库拥有 Contents: write + Actions: write；同时用于 Artifact 下载代理和 Release Evidence。</p>{health?.githubConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置 GITHUB_TOKEN</span>}</div></div>
      <div className="setting-card"><ShieldCheck /><div><h3>Gitee 平台验证</h3><p>直接读取 Gitee 同版本 Release 与附件列表，并和 GitHub 应同步的小文件逐个对比。</p>{health?.platformVerification?.giteeConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Gitee API 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />缺少 GITEE_TOKEN / OWNER / REPO</span>}</div></div>
      <div className="setting-card"><ShieldCheck /><div><h3>TestFlight 平台验证</h3><p>通过 App Store Connect API 按 Bundle ID + 版本读取真实 Build、Processing State 与 Beta State。</p>{health?.platformVerification?.appStoreConnectConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />App Store Connect 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />缺少 App Store Connect API Key</span>}</div></div>
      <div className="setting-card"><Rocket /><div><h3>发布编排器</h3><p>Preflight 锁定 Commit、创建版本 Tag、跟踪正式 Workflow，并在服务端持续推进，不依赖浏览器保持打开。</p>{health?.releaseOrchestrator?.persistent ? <span className="setting-ok"><CheckCircle2 size={15} />持久编排已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><PackageCheck /><div><h3>Release Evidence</h3><p>Manifest 核心快照保持不可变；GitHub Release 与最终 Asset 作为追加式证据保存，记录官方 SHA256 与 Tag Commit 匹配。</p>{health?.manifests?.githubReleaseAssetDigest ? <span className="setting-ok"><CheckCircle2 size={15} />最终发行证据已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><Radio /><div><h3>SSE 实时通道</h3><p>浏览器与 Nowen Forge 服务端保持长连接，构建/发布事件到达后页面自动刷新。</p>{health?.realtime?.sse ? <span className="setting-ok"><CheckCircle2 size={15} />已启用</span> : <span className="setting-warn"><CircleAlert size={15} />不可用</span>}</div></div>
      <div className="setting-card"><Webhook /><div><h3>GitHub Webhook</h3><p>可选的秒级事件源。内网/NAS 无公网回调时可以不配置，系统会自动使用轮询兜底。</p>{health?.realtime?.webhookConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Secret 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置，当前使用轮询兜底</span>}</div></div>
      <div className="setting-card"><Database /><div><h3>SQLite</h3><p>保存项目、Webhook 幂等、Manifest、Release Evidence 与发布计划；不保存大体积制品和平台私钥。</p><span className="setting-ok"><CheckCircle2 size={15} />本地单用户模式</span></div></div>
      <div className="setting-card"><Server /><div><h3>执行引擎</h3><p>不自建 Runner，Windows / macOS / Linux / iOS / Docker 构建继续交给 GitHub Actions。</p><span className="setting-ok"><CheckCircle2 size={15} />GitHub Actions</span></div></div>
      <div className="setting-card"><Radio /><div><h3>验证原则</h3><p>V0.7 不允许用“同步/上传 Workflow 成功”冒充 Gitee 或 TestFlight 平台已经收到目标版本。</p>{health?.platformVerification?.workflowFallbackAsSuccess === false ? <span className="setting-ok"><CheckCircle2 size={15} />严格平台证据模式</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
    </div>

    <div className="panel docs"><h2>V0.7 最终平台验证配置</h2><pre>{`# Gitee\nGITEE_TOKEN=xxx\nGITEE_OWNER=cropflre\nGITEE_REPO=nowen-note\n\n# App Store Connect Team API Key\nAPPSTORE_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\nAPPSTORE_API_KEY_ID=XXXXXXXXXX\nAPPSTORE_API_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\nAPPSTORE_BUNDLE_ID=com.nowen.note`}</pre></div>
    <div className="panel docs"><h2>基础配置</h2><pre>{`GITHUB_TOKEN=github_pat_xxx\nGITHUB_WEBHOOK_SECRET=可选\nRUN_POLL_INTERVAL_MS=12000\nPORT=3001\n\n# Docker\ndocker compose up -d --build`}</pre></div>
    <div className="panel docs"><h2>可选：GitHub Webhook</h2><p className="muted">只有 Nowen Forge 有 GitHub 可访问的 HTTPS 地址时才需要配置。没有公网地址可以跳过。</p><pre>{`Payload URL\n${webhookUrl}\n\nContent type\napplication/json\n\nSecret\n与 GITHUB_WEBHOOK_SECRET 完全一致\n\n推荐事件\nWorkflow runs / Workflow jobs / Releases / Pushes`}</pre></div>
  </section>;
}
