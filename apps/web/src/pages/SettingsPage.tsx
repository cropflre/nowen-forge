import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Database, Github, Radio, Server, Webhook } from 'lucide-react';
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
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false, githubConfigured: false })); }, []);
  const webhookUrl = useMemo(() => `${window.location.origin}/api/webhooks/github`, []);
  const pollSeconds = health?.realtime ? Math.round(health.realtime.pollIntervalMs / 1000) : null;

  return <section><div className="page-head"><div><span className="eyebrow">SETTINGS</span><h1>设置</h1><p>V0.3 仍采用服务端环境变量配置，Token 和 Webhook Secret 不进入浏览器或 SQLite</p></div></div>
    <div className="settings-grid">
      <div className="setting-card"><Github /><div><h3>GitHub Token</h3><p>用于启动、取消、重跑 GitHub Actions，也提高服务端轮询 GitHub API 的限额。</p>{health?.githubConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置 GITHUB_TOKEN</span>}</div></div>
      <div className="setting-card"><Radio /><div><h3>SSE 实时通道</h3><p>浏览器与 Nowen Forge 服务端保持长连接，构建/发布事件到达后页面自动刷新。</p>{health?.realtime?.sse ? <span className="setting-ok"><CheckCircle2 size={15} />已启用</span> : <span className="setting-warn"><CircleAlert size={15} />不可用</span>}</div></div>
      <div className="setting-card"><Webhook /><div><h3>GitHub Webhook</h3><p>可选的秒级事件源。内网/NAS 无公网回调时可以不配置，系统会自动使用轮询兜底。</p>{health?.realtime?.webhookConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />Secret 已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置，当前使用轮询兜底</span>}</div></div>
      <div className="setting-card"><Database /><div><h3>SQLite</h3><p>数据库默认位于 <code>data/nowen-forge.db</code>，并记录 Webhook delivery id 用于幂等去重。</p><span className="setting-ok"><CheckCircle2 size={15} />本地单用户模式</span></div></div>
      <div className="setting-card"><Server /><div><h3>执行引擎</h3><p>不自建 Runner，Windows / macOS / Linux / iOS / Docker 构建继续交给 GitHub Actions。</p><span className="setting-ok"><CheckCircle2 size={15} />GitHub Actions</span></div></div>
      <div className="setting-card"><Radio /><div><h3>轮询兜底</h3><p>服务端主动读取 GitHub 状态，不要求 Forge 暴露公网地址。</p><span className="setting-ok"><CheckCircle2 size={15} />{pollSeconds ? `每 ${pollSeconds} 秒同步` : '已启用'}</span></div></div>
    </div>

    <div className="panel docs"><h2>基础配置</h2><pre>{`# .env\nGITHUB_TOKEN=github_pat_xxx\nGITHUB_WEBHOOK_SECRET=请生成一段随机长字符串\nRUN_POLL_INTERVAL_MS=12000\nPORT=3001\n\n# Docker\ndocker compose up -d --build`}</pre></div>
    <div className="panel docs"><h2>可选：GitHub Webhook</h2><p className="muted">只有 Nowen Forge 有 GitHub 可访问的 HTTPS 地址时才需要配置。没有公网地址可以跳过。</p><pre>{`Payload URL\n${webhookUrl}\n\nContent type\napplication/json\n\nSecret\n与 GITHUB_WEBHOOK_SECRET 完全一致\n\n推荐事件\nWorkflow runs / Workflow jobs / Releases / Pushes`}</pre></div>
  </section>;
}
