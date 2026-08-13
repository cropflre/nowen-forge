import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, LoaderCircle, Play, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Project, Run, Workflow } from '../types';
import StatusBadge from '../components/StatusBadge';
import DispatchModal from '../components/DispatchModal';

export default function ProjectPage() {
  const id = Number(useParams().id);
  const [project, setProject] = useState<Project | null>(null);
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const currentRun = useMemo(() => runs.find((run) => run.id === selectedRun), [runs, selectedRun]);

  async function load() {
    try {
      setLoading(true); setError('');
      const [meta, workflowData, branchData, runData] = await Promise.all([api.meta(id), api.workflows(id), api.branches(id), api.runs(id)]);
      setProject(meta.project); setDefaultBranch(meta.defaultBranch); setWorkflows(workflowData.workflows); setBranches(branchData.branches); setRuns(runData.runs);
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);
  useEffect(() => { if (!selectedRun) { setDetails(null); return; } api.run(id, selectedRun).then(setDetails).catch((e) => setError(e.message)); }, [id, selectedRun]);
  if (loading && !project) return <div className="loading"><LoaderCircle className="spin" />正在加载项目…</div>;
  if (!project) return <div className="alert error">{error || '项目不存在'}</div>;

  async function action(kind: 'rerun' | 'cancel', runId: number) { try { kind === 'rerun' ? await api.rerunFailed(id, runId) : await api.cancel(id, runId); await load(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } }

  return <section>
    <Link className="back" to="/projects"><ArrowLeft size={16} />返回项目</Link>
    <div className="page-head project-page-head"><div><span className="eyebrow">{project.kind.toUpperCase()}</span><h1>{project.displayName}</h1><p>{project.description} · {project.owner}/{project.repo}</p></div><button className="button secondary" onClick={load}><RefreshCw size={16} />同步</button></div>
    {error && <div className="alert error">{error}</div>}
    <div className="section-title"><div><h2>流水线</h2><p>推荐流水线已置顶；运行前可选择分支 / Tag 和 Workflow inputs</p></div></div>
    <div className="workflow-grid">{workflows.map((workflow) => <div className="workflow-card" key={workflow.id}><div><div className="workflow-name">{workflow.name}{workflow.recommended && <span className="recommended">推荐</span>}</div><span className="mono muted">{workflow.path}</span></div><button className="button primary small" disabled={workflow.state !== 'active'} onClick={() => setSelectedWorkflow(workflow)}><Play size={15} />运行</button></div>)}</div>
    <div className="section-title"><div><h2>构建记录</h2><p>点击记录查看 Job、Step 与 Artifact</p></div></div>
    <div className="panel"><div className="run-list">{runs.map((run) => <button className={selectedRun === run.id ? 'run-row selected' : 'run-row'} key={run.id} onClick={() => setSelectedRun(run.id)}><div><strong>{run.displayTitle || run.name}</strong><span>#{run.runNumber} · {run.headBranch || '—'} · {new Date(run.createdAt).toLocaleString()}</span></div><StatusBadge status={run.status} conclusion={run.conclusion} /></button>)}{!runs.length && <div className="empty">暂无构建记录</div>}</div></div>
    {currentRun && <div className="detail-drawer"><div className="detail-head"><div><span className="eyebrow">RUN #{currentRun.runNumber}</span><h2>{currentRun.displayTitle || currentRun.name}</h2></div><button className="close" onClick={() => setSelectedRun(null)}>×</button></div><div className="detail-actions"><a className="button secondary" href={currentRun.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />GitHub 日志</a>{currentRun.status !== 'completed' && <button className="button danger" onClick={() => action('cancel', currentRun.id)}><XCircle size={15} />取消</button>}{currentRun.status === 'completed' && currentRun.conclusion !== 'success' && <button className="button secondary" onClick={() => action('rerun', currentRun.id)}><RotateCcw size={15} />重跑失败 Job</button>}</div>
      {!details ? <div className="loading small"><LoaderCircle className="spin" />加载详情…</div> : <><h3>Jobs</h3><div className="job-list">{details.jobs.map((job: any) => <div className="job" key={job.id}><div><strong>{job.name}</strong><span>{job.steps.filter((s: any) => s.conclusion === 'success').length}/{job.steps.length} steps</span></div><StatusBadge status={job.status} conclusion={job.conclusion} /></div>)}</div><h3>Artifacts</h3><div className="artifact-list">{details.artifacts.map((a: any) => <div className="artifact" key={a.id}><div><strong>{a.name}</strong><span>{(a.sizeInBytes / 1024 / 1024).toFixed(1)} MB · {a.expired ? '已过期' : '可用'}</span></div></div>)}{!details.artifacts.length && <div className="empty compact">本次运行没有 Artifact</div>}</div></>}
    </div>}
    <DispatchModal workflow={selectedWorkflow} branches={branches} defaultBranch={defaultBranch} onClose={() => setSelectedWorkflow(null)} onDispatch={async (ref, inputs) => { await api.dispatch(id, selectedWorkflow!.id, ref, inputs); setTimeout(() => void load(), 1500); }} />
  </section>;
}
