import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Github, Database, Server } from 'lucide-react';
import { api } from '../api';

export default function SettingsPage() {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false, githubConfigured: false })); }, []);
  return <section><div className="page-head"><div><span className="eyebrow">SETTINGS</span><h1>设置</h1><p>V0.1 采用环境变量配置，避免 Token 明文写入 SQLite 或浏览器</p></div></div>
    <div className="settings-grid"><div className="setting-card"><Github /><div><h3>GitHub Token</h3><p>用于启动、取消、重跑 GitHub Actions。建议使用 Fine-grained PAT，仅授权 Nowen 相关仓库。</p>{health?.githubConfigured ? <span className="setting-ok"><CheckCircle2 size={15} />已配置</span> : <span className="setting-warn"><CircleAlert size={15} />未配置 GITHUB_TOKEN</span>}</div></div><div className="setting-card"><Database /><div><h3>SQLite</h3><p>数据库默认位于 <code>data/nowen-forge.db</code>，Docker 下挂载到 <code>/app/data</code>。</p><span className="setting-ok"><CheckCircle2 size={15} />本地单用户模式</span></div></div><div className="setting-card"><Server /><div><h3>执行引擎</h3><p>V0.1 不自建 Runner，所有构建继续由各项目现有 GitHub Actions 执行。</p><span className="setting-ok"><CheckCircle2 size={15} />GitHub Actions</span></div></div></div>
    <div className="panel docs"><h2>配置方法</h2><pre>{`# .env\nGITHUB_TOKEN=github_pat_xxx\nPORT=3001\n\n# 本地\nnpm install\nnpm run dev\n\n# Docker\ndocker compose up -d --build`}</pre></div>
  </section>;
}
