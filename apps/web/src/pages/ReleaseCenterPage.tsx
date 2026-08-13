import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleMinus, ExternalLink, LoaderCircle, Package, Radio, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ReleaseCenter, ReleaseChannel } from '../types';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import '../release.css';

export default function ReleaseCenterPage() {
  const [data, setData] = useState<ReleaseCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true); setError('');
      setData(await api.releaseCenter());
    } catch (e) { setError(e instanceof Error ? e.message : '加载发布中心失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const realtimeConnected = useRealtimeRefresh(load);
  const latestPublished = useMemo(() => data?.recentReleases.find((release) => !release.draft)?.tagName || '—', [data]);

  if (loading && !data) return <div className="loading"><LoaderCircle className="spin" />正在读取最终发布平台…</div>;

  return <section>
    <div className="page-head"><div><span className="eyebrow">RELEASE CENTER · V0.7</span><h1>发布中心</h1><p>GitHub / Docker Hub / Gitee / TestFlight 均优先读取目标平台真实状态，不再把 Workflow 成功等同于发布成功</p></div><div className="page-actions"><span className={realtimeConnected ? 'live-state connected' : 'live-state'}><Radio size={13} />{realtimeConnected ? '实时连接' : '正在重连'}</span><button className="button secondary" onClick={load}><RefreshCw size={16} />刷新平台</button></div></div>
    {error && <div className="alert error">{error}</div>}
    {data && <>
      <div className="stat-grid release-stats">
        <Stat icon={<Package size={18} />} label="项目" value={data.stats.projectCount} />
        <Stat icon={<Rocket size={18} />} label="发布渠道" value={data.stats.channelCount} />
        <Stat icon={<ShieldCheck size={18} />} label="平台验证成功" value={data.stats.platformVerifiedCount} />
        <Stat icon={<AlertTriangle size={18} />} label="未配置验证" value={data.stats.unverifiedCount} tone={data.stats.unverifiedCount ? 'warning' : undefined} />
        <Stat icon={<AlertTriangle size={18} />} label="需关注" value={data.stats.attentionCount} tone={data.stats.attentionCount ? 'warning' : undefined} />
      </div>

      <div className="release-overview"><span>最近正式版本</span><strong>{latestPublished}</strong><small>“平台已验证”表示 Forge 直接从目标平台 API 读到了版本/制品/Build；“未配置”不会降级成 Workflow 成功。</small></div>

      <div className="section-title"><div><h2>项目发布状态</h2><p>每个渠道独立验证，平台数据与构建流水线状态分离</p></div></div>
      <div className="release-project-grid">{data.projects.map(({ project, latestRelease, channels }) => <article className="release-project-card" key={project.id}>
        <div className="release-project-head"><div className={`project-mark kind-${project.kind}`}>{project.displayName.slice(0, 1)}</div><div><Link to={`/projects/${project.id}`}><h3>{project.displayName}</h3></Link><span>{project.owner}/{project.repo}</span></div><div className="release-version"><small>Latest</small><strong>{latestRelease?.tagName || '—'}</strong></div></div>
        <div className="release-channel-list">{channels.map((channel) => <ChannelRow key={`${project.id}-${channel.kind}`} channel={channel} />)}</div>
      </article>)}</div>

      <div className="section-title"><div><h2>最近 GitHub Releases</h2><p>最终 Release Asset 的 SHA256 证据继续在「制品中心」查看</p></div></div>
      <div className="panel"><div className="table-wrap"><table><thead><tr><th>项目</th><th>版本</th><th>状态</th><th>制品</th><th>发布时间</th><th /></tr></thead><tbody>{data.recentReleases.map((release) => <tr key={`${release.projectSlug}-${release.id}`}><td><Link className="project-link" to={`/projects/${release.projectId}`}>{release.projectName}</Link></td><td><strong>{release.tagName}</strong><div className="muted">{release.name}</div></td><td>{release.draft ? <span className="release-state warning">Draft</span> : release.prerelease ? <span className="release-state running">Pre-release</span> : <span className="release-state success">Published</span>}</td><td>{release.assets.length}</td><td>{new Date(release.publishedAt || release.createdAt).toLocaleString()}</td><td><a className="icon-link" href={release.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a></td></tr>)}{!data.recentReleases.length && <tr><td colSpan={6}><div className="empty compact">还没有 GitHub Release</div></td></tr>}</tbody></table></div></div>
    </>}
  </section>;
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string | number; tone?: string }) {
  return <div className={`stat-card ${tone ? `stat-${tone}` : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function ChannelRow({ channel }: { channel: ReleaseChannel }) {
  const Icon = channel.status === 'success' ? CheckCircle2 : channel.status === 'failed' || channel.status === 'warning' || channel.status === 'unavailable' ? AlertTriangle : CircleMinus;
  const verifyLabel = channel.verification === 'platform' ? '平台已验证' : channel.verification === 'unconfigured' ? '平台未配置' : channel.verification === 'workflow' ? '仅流水线' : '';
  return <div className="release-channel"><div className={`channel-icon channel-${channel.status}`}><Icon size={15} /></div><div className="channel-copy"><div><strong>{channel.label}</strong><span className={`release-state ${channel.status}`}>{channel.status === 'success' ? '正常' : channel.status === 'running' ? '处理中' : channel.status === 'failed' ? '失败' : channel.status === 'warning' ? '需确认' : channel.status === 'empty' ? '暂无' : '不可用'}</span>{verifyLabel && <span className={`platform-proof proof-${channel.verification}`}>{verifyLabel}</span>}</div><p>{channel.summary}</p>{channel.detail && <small>{channel.detail}</small>}{channel.tags?.length ? <div className="release-tags">{channel.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}</div>{channel.url && <a className="channel-link" href={channel.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</div>;
}
