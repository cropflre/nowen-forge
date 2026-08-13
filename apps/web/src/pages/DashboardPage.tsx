import { useEffect, useState } from 'react';
import { Box, CheckCircle2, LoaderCircle, Rocket, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { Dashboard } from '../types';
import RunTable from '../components/RunTable';
import StatusBadge from '../components/StatusBadge';
import { Link } from 'react-router-dom';

export default function DashboardPage({ runsOnly = false }: { runsOnly?: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() { try { setLoading(true); setData(await api.dashboard()); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  if (loading && !data) return <div className="loading"><LoaderCircle className="spin" /> 正在同步 GitHub Actions…</div>;
  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return null;

  if (runsOnly) return <section><PageHead title="构建记录" desc="最近 4 个 Nowen 项目的 GitHub Actions 运行记录" onRefresh={load} /><div className="panel"><RunTable runs={data.latestRuns} /></div></section>;

  const stats = [
    { label: '项目', value: data.stats.projectCount, icon: Box },
    { label: '最近构建', value: data.stats.recentRunCount, icon: Rocket },
    { label: '运行中', value: data.stats.runningCount, icon: LoaderCircle },
    { label: '成功率', value: data.stats.successRate == null ? '—' : `${data.stats.successRate}%`, icon: CheckCircle2 }
  ];
  return <section>
    <PageHead title="仪表盘" desc="Nowen 系列统一构建与发布控制台" onRefresh={load} />
    {!data.githubConfigured && <div className="alert warning">当前未配置 GITHUB_TOKEN：可以读取公开构建记录，但不能启动、取消或重跑流水线。<Link to="/settings">去设置</Link></div>}
    <div className="stat-grid">{stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}><div className="stat-icon"><Icon size={20} /></div><div><span>{label}</span><strong>{value}</strong></div></div>)}</div>
    <div className="section-title"><div><h2>项目状态</h2><p>每个项目的最近一次构建</p></div><Link to="/projects">查看全部项目 →</Link></div>
    <div className="project-grid">{data.projects.map((project) => <Link className="project-card" to={`/projects/${project.id}`} key={project.id}><div className="project-top"><div className={`project-mark kind-${project.kind}`}>{project.displayName.slice(0, 1)}</div><div><h3>{project.displayName}</h3><span>{project.owner}/{project.repo}</span></div></div><p>{project.description}</p><div className="project-bottom">{project.error ? <span className="error-text">同步失败</span> : project.latestRun ? <><StatusBadge status={project.latestRun.status} conclusion={project.latestRun.conclusion} /><span className="muted">#{project.latestRun.runNumber}</span></> : <span className="muted">暂无构建</span>}</div></Link>)}</div>
    <div className="section-title"><div><h2>最近构建</h2><p>跨项目聚合</p></div></div><div className="panel"><RunTable runs={data.latestRuns.slice(0, 10)} /></div>
  </section>;
}

function PageHead({ title, desc, onRefresh }: { title: string; desc: string; onRefresh: () => void }) { return <div className="page-head"><div><span className="eyebrow">NOWEN FORGE</span><h1>{title}</h1><p>{desc}</p></div><button className="button secondary" onClick={onRefresh}><RefreshCw size={16} />刷新</button></div>; }
