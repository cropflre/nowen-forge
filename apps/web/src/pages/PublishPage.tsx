import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleMinus, ExternalLink, GitCommit, LoaderCircle, Radio, RefreshCw, Rocket, RotateCcw, ShieldCheck, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Project, ReleasePlan, ReleasePlanCenter, ReleasePlanRun, ReleasePreflight, ReleaseRecoveryChannel, ReleaseRecoveryState } from '../types';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import '../publish.css';

const activeStatuses = new Set(['PREPARING', 'WAITING_RUNS', 'RUNNING']);
const activeRecoveryStatuses = new Set(['requested', 'running', 'waiting_platform']);

export default function PublishPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(0);
  const [version, setVersion] = useState('');
  const [sourceRef, setSourceRef] = useState('main');
  const [refs, setRefs] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<ReleasePreflight | null>(null);
  const [center, setCenter] = useState<ReleasePlanCenter | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const loadPlans = async () => {
    try { setCenter(await api.releasePlans()); } catch (e) { setError(e instanceof Error ? e.message : '加载发布计划失败'); }
  };

  useEffect(() => {
    api.projects().then((data) => {
      const items = data.projects as Project[];
      setProjects(items);
      if (items[0]) setProjectId(items[0].id);
    }).catch((e) => setError(e instanceof Error ? e.message : '加载项目失败'));
    void loadPlans();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setPreflight(null);
    Promise.all([api.meta(projectId), api.branches(projectId)]).then(([meta, refData]) => {
      setSourceRef(meta.defaultBranch || 'main');
      setRefs([...refData.branches, ...refData.tags]);
    }).catch((e) => setError(e instanceof Error ? e.message : '加载 Git 引用失败'));
  }, [projectId]);

  const realtime = useRealtimeRefresh(loadPlans);
  const hasActive = center?.plans.some((plan) => activeStatuses.has(plan.status)) || false;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadPlans(), 5000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const projectPlans = useMemo(() => center?.plans.filter((plan) => plan.project.id === projectId) || [], [center, projectId]);

  async function check() {
    if (!projectId || !version.trim() || !sourceRef.trim()) return;
    try {
      setChecking(true); setError('');
      setPreflight(await api.releasePreflight(projectId, version, sourceRef));
    } catch (e) { setError(e instanceof Error ? e.message : 'Preflight 失败'); }
    finally { setChecking(false); }
  }

  async function start() {
    if (!preflight?.canStart) return;
    const ok = window.confirm(`确认发布 ${preflight.project.displayName} ${preflight.version}？\n\n将创建不可变 Tag ${preflight.tagName}，锁定 Commit ${preflight.sourceSha.slice(0, 12)}，并启动正式发布流水线。`);
    if (!ok) return;
    try {
      setStarting(true); setError('');
      await api.startRelease(preflight.project.id, preflight.version, preflight.sourceRef);
      setPreflight(null);
      setVersion('');
      await loadPlans();
    } catch (e) { setError(e instanceof Error ? e.message : '启动发布失败'); }
    finally { setStarting(false); }
  }

  return <section>
    <div className="page-head"><div><span className="eyebrow">ONE-CLICK RELEASE</span><h1>一键发布</h1><p>Preflight 锁定 Commit → 创建版本 Tag → 触发正式流水线 → 自动追踪 → 固化 Manifest → 按失败节点恢复</p></div><span className={realtime ? 'live-state connected' : 'live-state'}><Radio size={13} />{realtime ? '实时连接' : '正在重连'}</span></div>
    {error && <div className="alert error">{error}</div>}

    <div className="publish-layout">
      <div className="panel publish-form">
        <div className="publish-step-title"><span>1</span><div><h2>发布配置</h2><p>先检查，不会立即创建 Tag。</p></div></div>
        <label>项目<select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>{projects.map((project) => <option value={project.id} key={project.id}>{project.displayName}</option>)}</select></label>
        <label>版本<input value={version} onChange={(e) => { setVersion(e.target.value); setPreflight(null); }} placeholder="例如 1.4.11 或 v1.4.11" /></label>
        <label>来源 Branch / Tag / Commit<input list="release-refs" value={sourceRef} onChange={(e) => { setSourceRef(e.target.value); setPreflight(null); }} /><datalist id="release-refs">{refs.map((ref) => <option value={ref} key={ref} />)}</datalist></label>
        <button className="button primary publish-check" onClick={check} disabled={checking || !projectId || !version.trim() || !sourceRef.trim()}>{checking ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}{checking ? '检查中…' : '发布前检查'}</button>
      </div>

      <div className="panel preflight-panel">
        <div className="publish-step-title"><span>2</span><div><h2>Preflight</h2><p>Tag 创建前最后确认真实 Commit 和流水线。</p></div></div>
        {!preflight ? <div className="empty">填写左侧配置并执行发布前检查</div> : <PreflightCard data={preflight} onStart={start} starting={starting} />}
      </div>
    </div>

    {center && <>
      <div className="stat-grid release-plan-stats">
        <Stat label="发布计划" value={center.stats.total} />
        <Stat label="进行中" value={center.stats.active} />
        <Stat label="已成功" value={center.stats.succeeded} />
        <Stat label="需关注" value={center.stats.attention} />
      </div>
      <div className="section-title"><div><h2>{selectedProject?.displayName || '项目'} 发布历史</h2><p>V0.8 支持只恢复失败流水线或失败渠道；原 Run / Manifest 保持历史证据，不会被覆盖。</p></div></div>
      <div className="release-plan-list">{projectPlans.map((plan) => <PlanCard key={plan.id} plan={plan} onChanged={loadPlans} />)}{!projectPlans.length && <div className="panel empty">这个项目还没有一键发布记录</div>}</div>
    </>}
  </section>;
}

function PreflightCard({ data, onStart, starting }: { data: ReleasePreflight; onStart: () => void; starting: boolean }) {
  return <div className="preflight-content">
    <div className="preflight-lock"><GitCommit size={18} /><div><span>锁定 Commit</span><a href={data.sourceUrl} target="_blank" rel="noreferrer"><strong>{data.sourceSha.slice(0, 12)}</strong><ExternalLink size={13} /></a><small>{data.sourceRef}</small></div></div>
    <div className="preflight-lock"><Tag size={18} /><div><span>版本 Tag</span><strong>{data.tagName}</strong><small>{data.tag.exists ? data.tag.matchesSource ? '已存在 · 与来源 Commit 一致' : '已存在 · Commit 冲突' : '尚未创建'}</small></div></div>
    <div className="preflight-workflows">{data.workflows.map((workflow) => <div className="preflight-workflow" key={workflow.workflowPath}><div><strong>{workflow.role}</strong><span>{workflow.workflowName}</span><small>{workflow.workflowPath}</small></div>{workflow.dispatchable ? <span className="preflight-ok">可触发</span> : <span className="preflight-bad">不可触发</span>}</div>)}</div>
    {data.warnings.map((warning) => <div className="alert warning compact-alert" key={warning}><AlertTriangle size={15} />{warning}</div>)}
    {data.blockingReasons.map((reason) => <div className="alert error compact-alert" key={reason}><AlertTriangle size={15} />{reason}</div>)}
    <button className="button primary publish-start" onClick={onStart} disabled={!data.canStart || starting}>{starting ? <LoaderCircle className="spin" size={17} /> : <Rocket size={17} />}{starting ? '正在创建发布计划…' : `确认发布 ${data.version}`}</button>
    <p className="publish-danger-note">确认后会创建 Git Tag。Tag 是发布身份的一部分，Forge 不会自动移动或覆盖已存在的不同 Commit Tag。</p>
  </div>;
}

function PlanCard({ plan, onChanged }: { plan: ReleasePlan; onChanged: () => Promise<void> }) {
  const [recovery, setRecovery] = useState<ReleaseRecoveryState | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const completed = plan.runs.filter((run) => run.status === 'completed').length;
  const failedRuns = plan.runs.filter((run) => run.dispatchState === 'failed' || (run.status === 'completed' && run.conclusion !== 'success'));
  const statusLabel: Record<string, string> = { PREPARING: '准备中', WAITING_RUNS: '等待流水线', RUNNING: '构建中', SUCCEEDED: '发布成功', PARTIAL: '部分成功', FAILED: '发布失败' };
  const recoveryActive = recovery?.recoveries.some((attempt) => activeRecoveryStatuses.has(attempt.status)) || false;

  async function inspectRecovery() {
    try {
      setCheckingRecovery(true); setRecoveryError('');
      setRecovery(await api.releaseRecovery(plan.id));
    } catch (e) { setRecoveryError(e instanceof Error ? e.message : '检查恢复状态失败'); }
    finally { setCheckingRecovery(false); }
  }

  useEffect(() => {
    if (!recoveryActive) return;
    const timer = window.setInterval(() => void inspectRecovery(), 5000);
    return () => window.clearInterval(timer);
  }, [recoveryActive, plan.id]);

  async function retryFailed() {
    if (!failedRuns.length) return;
    const ok = window.confirm(`确认恢复 ${plan.version} 的 ${failedRuns.length} 条失败流水线？\n\n已失败的 Workflow 会优先只重跑失败 Job；原 Run 和 Manifest 历史不会删除。`);
    if (!ok) return;
    try {
      setRecoveryAction('workflow'); setRecoveryError('');
      setRecovery(await api.retryFailedRelease(plan.id));
      await onChanged();
    } catch (e) { setRecoveryError(e instanceof Error ? e.message : '重试失败流水线失败'); }
    finally { setRecoveryAction(''); }
  }

  async function retryChannel(channel: ReleaseRecoveryChannel) {
    if (!channel.retryable || channel.kind === 'github') return;
    const ok = window.confirm(`确认${channel.retryLabel || '重试渠道'} ${plan.version}？\n\n只会触发 ${channel.label} 对应的恢复 Workflow，不会重新执行其他已成功渠道。`);
    if (!ok) return;
    try {
      setRecoveryAction(channel.kind); setRecoveryError('');
      setRecovery(await api.retryReleaseChannel(plan.id, channel.kind));
    } catch (e) { setRecoveryError(e instanceof Error ? e.message : '渠道重试失败'); }
    finally { setRecoveryAction(''); }
  }

  return <article className="panel release-plan-card">
    <div className="release-plan-head"><div><div className="release-plan-version"><span className={`plan-status plan-${plan.status.toLowerCase()}`}>{statusLabel[plan.status] || plan.status}</span><h3>{plan.version}</h3>{recoveryActive && <span className="recovery-live"><LoaderCircle size={12} className="spin" />恢复中</span>}</div><p>{plan.project.displayName} · {plan.sourceRef} · <code>{plan.sourceSha.slice(0, 12)}</code></p></div><div className="release-plan-progress"><strong>{completed}/{plan.runs.length}</strong><span>流水线完成</span></div></div>
    {plan.errorMessage && <div className="alert error compact-alert">{plan.errorMessage}</div>}
    {recoveryError && <div className="alert error compact-alert">{recoveryError}</div>}
    <div className="plan-run-list">{plan.runs.map((run) => <PlanRunRow run={run} key={run.id} />)}</div>

    <div className="recovery-actions">
      {failedRuns.length > 0 && <button className="button secondary" onClick={retryFailed} disabled={Boolean(recoveryAction)}>{recoveryAction === 'workflow' ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}重试失败流水线</button>}
      <button className="button secondary" onClick={inspectRecovery} disabled={checkingRecovery}>{checkingRecovery ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{recovery ? '重新检查渠道' : '检查发布渠道'}</button>
    </div>

    {recovery && <RecoveryPanel state={recovery} action={recoveryAction} onRetry={retryChannel} />}

    <div className="release-plan-foot"><span>{plan.tagCreated ? `已创建 ${plan.tagName}` : plan.tagReused ? `复用 ${plan.tagName}` : plan.tagName}</span><span>{new Date(plan.createdAt).toLocaleString()}</span>{plan.runs.some((run) => run.manifestId) && <Link to="/artifacts">查看 Manifest →</Link>}</div>
  </article>;
}

function RecoveryPanel({ state, action, onRetry }: { state: ReleaseRecoveryState; action: string; onRetry: (channel: ReleaseRecoveryChannel) => void }) {
  return <div className="recovery-panel">
    <div className="recovery-panel-head"><div><strong>发布恢复</strong><span>按 {state.plan.version} 精确检查，不使用其他最新版本状态</span></div><small>原发布证据只读 · 恢复记录追加保存</small></div>
    <div className="recovery-channels">{state.channels.map((channel) => <RecoveryChannelRow key={channel.kind} channel={channel} busy={action === channel.kind} onRetry={() => onRetry(channel)} />)}</div>
    {state.recoveries.length > 0 && <div className="recovery-history"><strong>恢复记录</strong>{state.recoveries.slice(0, 8).map((attempt) => <div className="recovery-attempt" key={attempt.id}><span className={`recovery-attempt-state state-${attempt.status}`}>{recoveryStatusLabel(attempt.status)}</span><div><b>{attempt.target}</b><small>{attempt.detail || attempt.action}</small></div><time>{new Date(attempt.requestedAt).toLocaleString()}</time></div>)}</div>}
  </div>;
}

function RecoveryChannelRow({ channel, busy, onRetry }: { channel: ReleaseRecoveryChannel; busy: boolean; onRetry: () => void }) {
  const successful = channel.status === 'success';
  const running = channel.status === 'running';
  const Icon = successful ? CheckCircle2 : channel.status === 'empty' ? CircleMinus : AlertTriangle;
  return <div className="recovery-channel-row"><div className={`recovery-channel-icon channel-${channel.status}`}><Icon size={15} /></div><div className="recovery-channel-copy"><div><strong>{channel.label}</strong><span className={`release-state ${channel.status}`}>{successful ? '正常' : running ? '处理中' : channel.status === 'empty' ? '缺失' : channel.status === 'failed' ? '失败' : '需确认'}</span>{channel.verification === 'platform' && <em>平台已验证</em>}{channel.verification === 'unconfigured' && <em className="unconfigured">平台未配置</em>}</div><p>{channel.summary}</p>{channel.detail && <small>{channel.detail}</small>}</div><div className="recovery-channel-actions">{channel.retryable && <button className="button secondary compact-button" onClick={onRetry} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <RotateCcw size={13} />}{channel.retryLabel}</button>}{channel.url && <a href={channel.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</div></div>;
}

function recoveryStatusLabel(status: string) {
  return status === 'requested' ? '已请求' : status === 'running' ? '执行中' : status === 'waiting_platform' ? '等平台' : status === 'success' ? '成功' : '失败';
}

function PlanRunRow({ run }: { run: ReleasePlanRun }) {
  const dispatchLabels: Record<string, string> = { pending: '等待 Tag 触发', auto: 'Tag 自动触发', manual: 'Forge 手动触发', fallback: 'Forge 兜底触发', failed: '触发失败' };
  const successful = run.status === 'completed' && run.conclusion === 'success';
  const failed = run.status === 'completed' && run.conclusion !== 'success' || run.dispatchState === 'failed';
  return <div className="plan-run-row"><div className={successful ? 'plan-run-icon success' : failed ? 'plan-run-icon failed' : 'plan-run-icon running'}>{successful ? <CheckCircle2 size={16} /> : failed ? <AlertTriangle size={16} /> : <LoaderCircle size={16} className={run.runId ? 'spin' : ''} />}</div><div className="plan-run-copy"><strong>{run.role}</strong><span>{run.workflowName}{run.runNumber ? ` · #${run.runNumber}` : ''}</span><small>{run.dispatchError || dispatchLabels[run.dispatchState]}</small></div><div className="plan-run-actions">{run.manifestId && <span className="manifest-ready">Manifest #{run.manifestId}</span>}{run.runUrl && <a href={run.runUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</div></div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat-card"><div><span>{label}</span><strong>{value}</strong></div></div>;
}
