import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Database, Github, PackageCheck, Radio, Rocket, Server, Webhook } from 'lucide-react';
import { api } from '../api';

type Health = {
  ok: boolean;
  githubConfigured: boolean;
  version?: string;
  realtime?: {
    sse: boolean;
    webhookConfigured: boolean;
    pollIntervalMs: number;
  };
  manifests?: {
    immutable: boolean;
    githubArtifactDigest: boolean;
    githubReleaseAssetDigest?: boolean;
    appendOnlyReleaseEvidence?: boolean;
  };
  releaseOrchestrator?: {
    enabled: boolean;
    persistent: boolean;
    tagPreflight: boolean;
  };
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false, githubConfigured: false })); }, []);
  const webhookUrl = useMemo(() => `${window.location.origin}/api/webhooks/github`, []);
  const pollSeconds = health?.realtime ? Math.round(health.realtime.pollIntervalMs / 1000) : null;

  return <section><div className="page-head"><div><span className="eyebrow">SETTINGS</span><h1>设置</h1><p>Nowen Forge {health?.version || 'V0.6'} · Token / Webhook Secret 只存在服务端环境变量</p></div></div>
    <div className="settings-grid">
      <div className="setting-card"><Github /><div><h3>GitHub Token</h3><p>一键发布需要 Fine-grained PAT 对 Nowen 仓库拥有 Contents: write + Actions: write；同时用于 Artifact 下载代理和 Release Evidence 同步。</p>{health?.githubConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置 GITHUB_TOKEN</span>}</div></div>
      <div className="setting-card"><Rocket /><div><h3>发布编排器</h3><p>Preflight 锁定 Commit、创建版本 Tag、跟踪正式 Workflow，并在服务端持续推进，不依赖浏览器保持打开。</p>{health?.releaseOrchestrator?.persistent ? <span className="setting-ok"><CheckCircle2 size={15} />持久编排已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><PackageCheck /><div><h3>Release Evidence</h3><p>Manifest 核心快照保持不可变；GitHub Release 与最终 Release Asset 作为追加式证据保存，并记录官方 SHA256 与 Tag Commit 匹配。</p>{health?.manifests?.githubReleaseAssetDigest ? <span className="setting-ok"><CheckCircle2 size={15} />最终发行证据已启用</span> : <span className="setting-warn"><CircleAlert size={15} />状态未知</span>}</div></div>
      <div className="setting-card"><Radio /><div><h3>SSE 实时通道</h3><p>浏览器与 Nowen Forge 服务端保持长连接，构建/发布事件到达后页面自动刷新。</p>{health?.realtime?.sse ? <span className="setting-ok"><CheckCircle2 size={15} />已启用</span> : <span className="setting-warn"><CircleAlert size={15} />不可用</span>}</div></div>
      <div className="setting-card"><Webhook /><div><h3>GitHub Webhook</h3><p>可选的秒级事件源。内网/NAS 无公网回调时可以不配置，系统会自动使用轮询兜底。</p>{health?.realtime?.webhookConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Secret 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置，当前使用轮询兜底</span>}</div></div>
      <div className="setting-card"><Database /><div><h3>SQLite</h3><p>保存项目配置、Webhook 幂等记录、Manifest、Release Evidence 与发布计划状态；不保存大体积制品文件。</p><span className="setting-ok"><CheckCircle2 size={15} />本地单用户模式</span></div></div>
      <div className="setting-card"><Server /><div><h3>执行引擎</h3><p>不自建 Runner，Windows / macOS / Linux / iOS / Docker 构建继续交给 GitHub Actions。</p><span className="setting-ok"><CheckCircle2 size={15} />GitHub Actions</span></div></div>
      <div className="setting-card"><Radio /><div><h3>轮询兜底</h3><p>服务端主动读取 GitHub 状态，不要求 Forge 暴露公网地址。</p><span className="setting-ok"><CheckCircle2 size={15} />{pollSeconds ? `每 ${pollSeconds} 秒同步` : '已启用'}</span></div></div>
    </div>

    <div className="panel docs"><h2>基础配置</h2><pre>{`# Fine-grained PAT\n# Repository permissions:\n#   Contents: Read and write\n#   Actions: Read and write\nGITHUB_TOKEN=github_pat_xxx\n\nGITHUB_WEBHOOK_SECRET=请生成一段随机长字符串\nRUN_POLL_INTERVAL_MS=12000\nPORT=3001\n\n# Docker\ndocker compose up -d --build`}</pre></div>
    <div className="panel docs"><h2>可选：GitHub Webhook</h2><p className="muted">只有 Nowen Forge 有 GitHub 可访问的 HTTPS 地址时才需要配置。没有公网地址可以跳过。</p><pre>{`Payload URL\n${webhookUrl}\n\nContent type\napplication/json\n\nSecret\n与 GITHUB_WEBHOOK_SECRET 完全一致\n\n推荐事件\nWorkflow runs / Workflow jobs / Releases / Pushes`}</pre></div>
  </section>;
}
