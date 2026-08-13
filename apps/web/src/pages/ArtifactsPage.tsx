import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Copy, Download, ExternalLink, FileCheck2, GitBranch, PackageCheck, Radio, RefreshCw, ShieldCheck, Boxes } from 'lucide-react';
import { Link } from 'react-router-dom';
import { evidenceApi } from '../evidenceApi';
import type { EvidenceManifest, EvidenceManifestCenter, EvidenceRunAttempt } from '../evidenceTypes';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import '../artifacts.css';

export default function ArtifactsPage() {
  const [data, setData] = useState<EvidenceManifestCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncingId, setSyncingId] = useState<number | null>(null);

  async function load() {
    try {
      setLoading(true);
      setData(await evidenceApi.manifests());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载制品中心失败');
    } finally {
      setLoading(false);
    }
  }

  async function syncEvidence(manifestId: number) {
    try {
      setSyncingId(manifestId);
      setError('');
      await evidenceApi.sync(manifestId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步发布证据失败');
    } finally {
      setSyncingId(null);
    }
  }

  useEffect(() => { void load(); }, []);
  const realtimeConnected = useRealtimeRefresh(load);

  if (loading && !data) return <div className="loading"><Archive className="spin" />正在读取 Manifest Evidence…</div>;

  return <section>
    <div className="page-head"><div><span className="eyebrow">ARTIFACT CENTER · V0.9</span><h1>制品中心</h1><p>Run Attempt、Workflow Artifact、Release Asset、Docker Manifest Digest 四层证据统一追溯</p></div><div className="page-actions"><span className={realtimeConnected ? 'live-state connected' : 'live-state'}><Radio size={13} />{realtimeConnected ? '实时连接' : '正在重连'}</span><button className="button secondary" onClick={load}><RefreshCw size={16} />刷新</button></div></div>
    {error && <div className="alert warning">{error}</div>}
    {data && <>
      <div className="stat-grid artifact-stats">
        <Stat icon={<PackageCheck size={18} />} label="Manifest" value={data.stats.manifestCount} />
        <Stat icon={<GitBranch size={18} />} label="Run Attempts" value={data.stats.runAttemptEvidenceCount} />
        <Stat icon={<Boxes size={18} />} label="Docker Evidence" value={data.stats.dockerEvidenceCount} />
        <Stat icon={<ShieldCheck size={18} />} label="Platform Digests" value={data.stats.dockerPlatformDigestCount} warning={data.stats.dockerDigestMutationCount > 0} />
      </div>

      <div className="artifact-total"><span>恢复可追溯</span><strong>{data.stats.recoveredManifestCount}</strong><small>个 Manifest 已记录多个 GitHub run_attempt。Artifact 保持 Run 级证据，不伪造 attempt 归属；Docker 版本镜像记录 Registry 返回的 manifest digest 与平台 digest。</small></div>

      {!data.manifests.length ? <div className="panel artifact-empty"><PackageCheck size={28} /><h2>还没有 Manifest</h2><p>进入任意项目 → 打开一个已完成的构建 → 点击「固化 Manifest」。</p><Link className="button primary" to="/projects">去项目列表</Link></div> : <div className="manifest-list">{data.manifests.map((manifest) => <ManifestCard key={manifest.id} manifest={manifest} syncing={syncingId === manifest.id} onSync={() => void syncEvidence(manifest.id)} />)}</div>}
    </>}
  </section>;
}

function Stat({ icon, label, value, warning }: { icon: ReactNode; label: string; value: string | number; warning?: boolean }) {
  return <div className={`stat-card ${warning ? 'stat-warning' : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function ManifestCard({ manifest, syncing, onSync }: { manifest: EvidenceManifest; syncing: boolean; onSync: () => void }) {
  const verified = manifest.artifacts.filter((artifact) => Boolean(artifact.digest)).length;
  const releaseEvidence = manifest.releaseEvidence;
  const docker = manifest.dockerEvidence;

  return <article className="manifest-card">
    <div className="manifest-head"><div className="manifest-title"><div className={`project-mark kind-${manifest.project.kind}`}>{manifest.project.displayName.slice(0, 1)}</div><div><div className="manifest-version"><strong>{manifest.version}</strong><span>{manifest.versionSource === 'tag' ? 'Tag' : manifest.versionSource === 'manual' ? 'Manual' : 'Build'}</span></div><Link to={`/projects/${manifest.project.id}`}>{manifest.project.displayName}</Link></div></div><div className="manifest-head-actions"><button className="button secondary small" disabled={syncing} onClick={onSync}><RefreshCw className={syncing ? 'spin' : ''} size={14} />{syncing ? '同步中' : '同步全部证据'}</button><div className={`manifest-result ${manifest.runConclusion === 'success' ? 'success' : 'warning'}`}>{manifest.runConclusion === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{manifest.runConclusion || 'unknown'}</div></div></div>

    <div className="manifest-meta"><div><span>Run</span><a href={manifest.runUrl} target="_blank" rel="noreferrer">#{manifest.runNumber} · {manifest.workflowName}<ExternalLink size={12} /></a></div><div><span>Ref</span><code>{manifest.ref || '—'}</code></div><div><span>Commit</span><code title={manifest.commitSha}>{manifest.commitSha.slice(0, 12)}</code></div><div><span>Created</span><strong>{new Date(manifest.createdAt).toLocaleString()}</strong></div></div>

    <div className="manifest-section-head"><div><h3>Run Attempt Evidence</h3><p>GitHub 同一个 Run 的每次 rerun 都单独固化；Job 来自指定 attempt API</p></div></div>
    {!manifest.runAttempts.length ? <div className="empty compact">尚未抓取 run_attempt 证据，点击「同步全部证据」。</div> : <div className="attempt-list">{manifest.runAttempts.map((attempt) => <AttemptRow key={attempt.runAttempt} attempt={attempt} />)}</div>}

    <div className="manifest-section-head"><div><h3>Workflow Artifacts</h3><p>{manifest.artifactCount} 个 · {formatBytes(manifest.totalSizeBytes)} · {verified} 个带 GitHub SHA256 · Run 级证据</p></div></div>
    <div className="manifest-artifacts">{manifest.artifacts.map((artifact) => {
      const expired = artifact.expiresAt ? new Date(artifact.expiresAt).getTime() <= Date.now() : false;
      return <div className="manifest-artifact" key={artifact.githubArtifactId}><div className="artifact-main"><Archive size={16} /><div><strong>{artifact.name}</strong><span>{formatBytes(artifact.sizeInBytes)} · {expired ? 'GitHub 已过期' : artifact.expiresAt ? `保留至 ${new Date(artifact.expiresAt).toLocaleDateString()}` : '保留期未知'}</span></div></div><Digest value={artifact.digest} empty="GitHub 未提供 digest" /><a className={`button secondary small ${expired ? 'disabled-link' : ''}`} href={expired ? undefined : evidenceApi.artifactDownloadUrl(manifest.project.id, artifact.githubArtifactId)}><Download size={14} />ZIP</a></div>;
    })}{!manifest.artifacts.length && <div className="empty compact">该 Run 没有 Workflow Artifact。</div>}</div>

    {docker.supported && <>
      <div className="manifest-section-head"><div><h3>Docker Manifest Evidence</h3><p>Docker Registry 真实 manifest digest 与多架构平台 digest</p></div></div>
      {!docker.current ? <div className="release-evidence-empty"><Boxes size={18} /><div><strong>尚未找到该版本 Docker Tag</strong><span>如果镜像稍后发布，点击「同步全部证据」再次抓取。</span></div></div> : <div className={`docker-evidence ${docker.digestChanged ? 'digest-mutated' : ''}`}>
        {docker.digestChanged && <div className="alert warning"><AlertTriangle size={15} />同一个版本 Tag 曾观测到不同 manifest digest，请检查是否发生过覆盖推送。</div>}
        <div className="docker-evidence-head"><div><strong>{docker.current.image}:{docker.current.tag}</strong><span>{docker.current.mediaType || 'manifest'}</span></div><Digest value={docker.current.digest} empty="未返回 manifest digest" /></div>
        <div className="docker-platforms">{docker.current.platforms.map((platform) => <div className="docker-platform" key={`${platform.os}/${platform.architecture}/${platform.variant || ''}`}><div><strong>{platform.os}/{platform.architecture}{platform.variant ? `/${platform.variant}` : ''}</strong><span>{platform.mediaType || 'image manifest'}</span></div><Digest value={platform.digest} empty="无 digest" /></div>)}</div>
        {docker.missingPlatforms.length > 0 && <div className="alert warning">缺少预期平台：{docker.missingPlatforms.join(', ')}</div>}
        <div className="release-evidence-summary"><ShieldCheck size={14} /><span>已观测 {docker.observations.length} 次 · {docker.current.platforms.length} 个平台 digest · {new Date(docker.current.observedAt).toLocaleString()}</span></div>
      </div>}
    </>}

    <div className="manifest-section-head"><div><h3>Final Release Assets</h3><p>GitHub Release 最终对用户分发的文件；SHA256 与 Workflow Artifact 独立</p></div></div>
    {!releaseEvidence ? <div className="release-evidence-empty"><FileCheck2 size={18} /><div><strong>尚未绑定 GitHub Release</strong><span>同步证据后会抓取同版本最终发行文件。</span></div></div> : <>
      <div className={`release-binding ${releaseEvidence.commitMatches ? 'verified' : 'mismatch'}`}><div><span>{releaseEvidence.commitMatches ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{releaseEvidence.commitMatches ? 'Tag Commit 精确匹配' : 'Tag Commit 与 Manifest 不一致'}</span><strong>{releaseEvidence.tagName}</strong><code title={releaseEvidence.tagCommitSha}>{releaseEvidence.tagCommitSha.slice(0, 12)}</code></div><a href={releaseEvidence.releaseUrl} target="_blank" rel="noreferrer">GitHub Release <ExternalLink size={12} /></a></div>
      <div className="release-asset-list">{releaseEvidence.assets.map((asset) => <div className="release-asset" key={asset.githubAssetId}><div className="release-asset-main"><FileCheck2 size={16} /><div><strong>{asset.name}</strong><span>{formatBytes(asset.sizeInBytes)} · {asset.contentType || 'unknown type'}</span></div></div><Digest value={asset.digest} empty="GitHub 未提供 digest" /><a className="button secondary small" href={asset.downloadUrl} target="_blank" rel="noreferrer"><Download size={14} />文件</a></div>)}</div>
    </>}
  </article>;
}

function AttemptRow({ attempt }: { attempt: EvidenceRunAttempt }) {
  const failed = attempt.conclusion && attempt.conclusion !== 'success';
  return <div className={`attempt-row ${failed ? 'failed' : 'success'}`}><div className="attempt-summary"><div><strong>attempt #{attempt.runAttempt}</strong><span>{attempt.conclusion || attempt.status}</span></div><small>{attempt.jobCount} Jobs · {attempt.failedJobCount} failed · {attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '未完成'}</small></div><div className="attempt-jobs">{attempt.jobs.map((job) => <a key={job.id} href={job.htmlUrl || undefined} target="_blank" rel="noreferrer" className={`attempt-job ${job.conclusion === 'success' ? 'success' : job.conclusion === 'skipped' ? 'skipped' : 'failed'}`}><span>{job.name}</span><strong>{job.conclusion || job.status}</strong></a>)}</div></div>;
}

function Digest({ value, empty }: { value: string | null; empty: string }) {
  return <div className="artifact-digest">{value ? <><code title={value}>{value}</code><button title="复制 digest" onClick={() => navigator.clipboard?.writeText(value)}><Copy size={13} /></button></> : <span>{empty}</span>}</div>;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
