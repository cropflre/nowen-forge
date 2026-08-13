import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Copy, Download, ExternalLink, FileCheck2, Link2, PackageCheck, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ManifestCenter, ReleaseManifest } from '../types';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import '../artifacts.css';

export default function ArtifactsPage() {
  const [data, setData] = useState<ManifestCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncingId, setSyncingId] = useState<number | null>(null);

  async function load() {
    try {
      setLoading(true);
      setData(await api.manifests());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载制品中心失败');
    } finally {
      setLoading(false);
    }
  }

  async function syncReleaseAssets(manifestId: number) {
    try {
      setSyncingId(manifestId);
      setError('');
      const result = await api.syncReleaseAssets(manifestId);
      if (!result.found) setError('该 Manifest 对应的 GitHub Release 还没有出现，可在 Release 完成后再次同步。');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步 GitHub Release Asset 失败');
    } finally {
      setSyncingId(null);
    }
  }

  useEffect(() => { void load(); }, []);
  const realtimeConnected = useRealtimeRefresh(load);

  if (loading && !data) return <div className="loading"><Archive className="spin" />正在读取 Manifest…</div>;

  return <section>
    <div className="page-head"><div><span className="eyebrow">ARTIFACT CENTER</span><h1>制品中心</h1><p>Build Artifact + Final Release Asset 双层证据：版本、Commit、Workflow、最终发行文件 SHA256 全链路可追溯</p></div><div className="page-actions"><span className={realtimeConnected ? 'live-state connected' : 'live-state'}><Radio size={13} />{realtimeConnected ? '实时连接' : '正在重连'}</span><button className="button secondary" onClick={load}><RefreshCw size={16} />刷新</button></div></div>
    {error && <div className="alert warning">{error}</div>}
    {data && <>
      <div className="stat-grid artifact-stats">
        <Stat icon={<PackageCheck size={18} />} label="Manifest" value={data.stats.manifestCount} />
        <Stat icon={<Archive size={18} />} label="Workflow Artifacts" value={data.stats.artifactCount} />
        <Stat icon={<FileCheck2 size={18} />} label="Release Assets" value={data.stats.releaseAssetCount} />
        <Stat icon={<ShieldCheck size={18} />} label="最终文件 SHA256" value={`${data.stats.digestedReleaseAssetCount}/${data.stats.releaseAssetCount}`} />
      </div>

      <div className="artifact-total"><span>双层制品证据</span><strong>{data.stats.exactCommitMatchCount}/{data.stats.releaseBoundManifestCount}</strong><small>已绑定 Release 的 Manifest 中，Tag Commit 与构建 Commit 精确一致的数量。Workflow Artifact 和 Release Asset 使用各自独立的 GitHub SHA256，不混淆两种文件层级。</small></div>

      {!data.manifests.length ? <div className="panel artifact-empty"><PackageCheck size={28} /><h2>还没有 Manifest</h2><p>进入任意项目 → 打开一个已完成的构建 → 点击「固化 Manifest」。</p><Link className="button primary" to="/projects">去项目列表</Link></div> : <div className="manifest-list">{data.manifests.map((manifest) => <ManifestCard key={manifest.id} manifest={manifest} syncing={syncingId === manifest.id} onSync={() => void syncReleaseAssets(manifest.id)} />)}</div>}
    </>}
  </section>;
}

function Stat({ icon, label, value, warning }: { icon: ReactNode; label: string; value: string | number; warning?: boolean }) {
  return <div className={`stat-card ${warning ? 'stat-warning' : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function ManifestCard({ manifest, syncing, onSync }: { manifest: ReleaseManifest; syncing: boolean; onSync: () => void }) {
  const verified = manifest.artifacts.filter((artifact) => Boolean(artifact.digest)).length;
  const releaseEvidence = manifest.releaseEvidence;
  const finalVerified = releaseEvidence?.assets.filter((asset) => Boolean(asset.digest)).length || 0;

  return <article className="manifest-card">
    <div className="manifest-head"><div className="manifest-title"><div className={`project-mark kind-${manifest.project.kind}`}>{manifest.project.displayName.slice(0, 1)}</div><div><div className="manifest-version"><strong>{manifest.version}</strong><span>{manifest.versionSource === 'tag' ? 'Tag' : manifest.versionSource === 'manual' ? 'Manual' : 'Build'}</span></div><Link to={`/projects/${manifest.project.id}`}>{manifest.project.displayName}</Link></div></div><div className={`manifest-result ${manifest.runConclusion === 'success' ? 'success' : 'warning'}`}>{manifest.runConclusion === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{manifest.runConclusion || 'unknown'}</div></div>

    <div className="manifest-meta"><div><span>Run</span><a href={manifest.runUrl} target="_blank" rel="noreferrer">#{manifest.runNumber} · {manifest.workflowName}<ExternalLink size={12} /></a></div><div><span>Ref</span><code>{manifest.ref || '—'}</code></div><div><span>Commit</span><code title={manifest.commitSha}>{manifest.commitSha.slice(0, 12)}</code></div><div><span>Created</span><strong>{new Date(manifest.createdAt).toLocaleString()}</strong></div></div>

    <div className="manifest-section-head"><div><h3>Workflow Artifacts</h3><p>{manifest.artifactCount} 个 · {formatBytes(manifest.totalSizeBytes)} · {verified} 个带 GitHub SHA256</p></div></div>
    <div className="manifest-artifacts">{manifest.artifacts.map((artifact) => {
      const expired = artifact.expiresAt ? new Date(artifact.expiresAt).getTime() <= Date.now() : false;
      return <div className="manifest-artifact" key={artifact.githubArtifactId}><div className="artifact-main"><Archive size={16} /><div><strong>{artifact.name}</strong><span>{formatBytes(artifact.sizeInBytes)} · {expired ? 'GitHub 已过期' : artifact.expiresAt ? `保留至 ${new Date(artifact.expiresAt).toLocaleDateString()}` : '保留期未知'}</span></div></div><div className="artifact-digest">{artifact.digest ? <><code title={artifact.digest}>{artifact.digest}</code><button title="复制 SHA256" onClick={() => navigator.clipboard?.writeText(artifact.digest!)}><Copy size={13} /></button></> : <span>GitHub 未提供 digest</span>}</div><a className={`button secondary small ${expired ? 'disabled-link' : ''}`} href={expired ? undefined : api.artifactDownloadUrl(manifest.project.id, artifact.githubArtifactId)}><Download size={14} />ZIP</a></div>;
    })}{!manifest.artifacts.length && <div className="empty compact">该构建没有 Workflow Artifact；Manifest 仍保留 Commit / Run / 发布渠道证据。</div>}</div>

    <div className="manifest-section-head release-evidence-head"><div><h3>Final Release Assets</h3><p>GitHub Release 最终对用户分发的文件；SHA256 与 Workflow Artifact digest 独立记录</p></div><button className="button secondary small" disabled={syncing} onClick={onSync}><RefreshCw className={syncing ? 'spin' : ''} size={14} />{syncing ? '同步中' : '同步 Release'}</button></div>

    {!releaseEvidence ? <div className="release-evidence-empty"><Link2 size={18} /><div><strong>尚未绑定 GitHub Release</strong><span>如果该版本有 GitHub Release，点击「同步 Release」抓取最终发行文件。</span></div></div> : <>
      <div className={`release-binding ${releaseEvidence.commitMatches ? 'verified' : 'mismatch'}`}>
        <div><span>{releaseEvidence.commitMatches ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{releaseEvidence.commitMatches ? 'Tag Commit 精确匹配' : 'Tag Commit 与 Manifest 不一致'}</span><strong>{releaseEvidence.tagName}</strong><code title={releaseEvidence.tagCommitSha}>{releaseEvidence.tagCommitSha.slice(0, 12)}</code></div>
        <a href={releaseEvidence.releaseUrl} target="_blank" rel="noreferrer">GitHub Release <ExternalLink size={12} /></a>
      </div>
      <div className="release-asset-list">{releaseEvidence.assets.map((asset) => <div className="release-asset" key={asset.githubAssetId}>
        <div className="release-asset-main"><FileCheck2 size={16} /><div><strong>{asset.name}</strong><span>{formatBytes(asset.sizeInBytes)} · {asset.contentType || 'unknown type'}{asset.sourceArtifactName ? ` · 来源分组 ${asset.sourceArtifactName}` : ''}</span></div></div>
        <div className="artifact-digest">{asset.digest ? <><code title={asset.digest}>{asset.digest}</code><button title="复制最终文件 SHA256" onClick={() => navigator.clipboard?.writeText(asset.digest!)}><Copy size={13} /></button></> : <span>GitHub 未提供 digest</span>}</div>
        <a className="button secondary small" href={asset.downloadUrl} target="_blank" rel="noreferrer"><Download size={14} />文件</a>
      </div>)}{!releaseEvidence.assets.length && <div className="empty compact">Release 已绑定，但当前没有 Release Asset。</div>}</div>
      <div className="release-evidence-summary"><ShieldCheck size={14} /><span>{finalVerified}/{releaseEvidence.assets.length} 个最终发行文件带 GitHub 官方 SHA256 · 证据首次观测于 {new Date(releaseEvidence.observedAt).toLocaleString()}</span></div>
    </>}

    <div className="manifest-section-head"><div><h3>Channel Snapshot</h3><p>创建 Manifest 当时的发布渠道快照</p></div></div>
    <div className="manifest-channels">{manifest.channels.map((channel) => <div className={`manifest-channel match-${String(channel.matchesVersion)}`} key={`${manifest.id}-${channel.kind}`}><div><strong>{channel.label}</strong><span>{channel.matchesVersion === true ? '版本匹配' : channel.matchesVersion === false ? '未匹配该版本' : '仅流水线状态'}</span></div><p>{channel.summary}</p>{channel.url && <a href={channel.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>}</div>)}</div>
  </article>;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
