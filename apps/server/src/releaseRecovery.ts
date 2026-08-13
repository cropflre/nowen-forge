import type { FastifyBaseLogger } from 'fastify';
import { db } from './db.js';
import { dispatchWorkflow, getWorkflowRun, getWorkflowSchema, githubConfigured, listRunsForWorkflow, listWorkflows, octokit, rerunFailed } from './github.js';
import { getReleasePlan } from './releasePlans.js';
import { buildReleaseVersionChannels, type Channel } from './releases.js';

export type ReleaseRecoveryKind = 'workflow' | 'gitee' | 'testflight' | 'dockerhub';
export type ReleaseRecoveryStatus = 'requested' | 'running' | 'waiting_platform' | 'success' | 'failed';

export type ReleaseRecoveryAttempt = {
  id: number;
  planId: number;
  kind: ReleaseRecoveryKind;
  target: string;
  action: string;
  runRowId: number | null;
  workflowId: string | null;
  workflowPath: string | null;
  sourceRunId: number | null;
  runId: number | null;
  status: ReleaseRecoveryStatus;
  detail: string | null;
  requestedAt: string;
  updatedAt: string;
};

const RECOVERY_POLL_MS = 10_000;
const activeRecoverySyncs = new Map<number, Promise<ReleaseRecoveryState | undefined>>();

const channelRetries: Partial<Record<string, Partial<Record<Exclude<ReleaseRecoveryKind, 'workflow'>, { path: string; inputs: (version: string) => Record<string, string> }>>>> = {
  'nowen-note': {
    gitee: { path: 'sync-gitee-release.yml', inputs: (version) => ({ tag: version }) },
    testflight: { path: 'ios-release.yml', inputs: () => ({ upload: 'true' }) }
  },
  'nowen-reader': {
    dockerhub: { path: 'build.yml', inputs: () => ({}) }
  },
  NOWEN: {
    dockerhub: { path: 'docker-publish.yml', inputs: () => ({}) }
  }
};

db.exec(`
  CREATE TABLE IF NOT EXISTS release_recovery_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES release_plans(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    action TEXT NOT NULL,
    run_row_id INTEGER REFERENCES release_plan_runs(id) ON DELETE SET NULL,
    workflow_id TEXT,
    workflow_path TEXT,
    source_run_id INTEGER,
    run_id INTEGER,
    status TEXT NOT NULL DEFAULT 'requested',
    detail TEXT,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_release_recovery_plan ON release_recovery_attempts(plan_id, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_release_recovery_active ON release_recovery_attempts(status, updated_at);
`);

function mapAttempt(row: any): ReleaseRecoveryAttempt {
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    kind: row.kind as ReleaseRecoveryKind,
    target: row.target,
    action: row.action,
    runRowId: row.run_row_id == null ? null : Number(row.run_row_id),
    workflowId: row.workflow_id || null,
    workflowPath: row.workflow_path || null,
    sourceRunId: row.source_run_id == null ? null : Number(row.source_run_id),
    runId: row.run_id == null ? null : Number(row.run_id),
    status: row.status as ReleaseRecoveryStatus,
    detail: row.detail || null,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at
  };
}

function getAttempt(id: number) {
  const row = db.prepare('SELECT * FROM release_recovery_attempts WHERE id = ?').get(id);
  return row ? mapAttempt(row) : undefined;
}

function listAttempts(planId: number) {
  return (db.prepare('SELECT * FROM release_recovery_attempts WHERE plan_id = ? ORDER BY id DESC LIMIT 50').all(planId) as any[]).map(mapAttempt);
}

function listActiveRecoveryPlanIds() {
  return (db.prepare("SELECT DISTINCT plan_id FROM release_recovery_attempts WHERE status IN ('requested','running','waiting_platform')").all() as any[])
    .map((row) => Number(row.plan_id));
}

function insertAttempt(input: {
  planId: number;
  kind: ReleaseRecoveryKind;
  target: string;
  action: string;
  runRowId?: number | null;
  workflowId?: string | null;
  workflowPath?: string | null;
  sourceRunId?: number | null;
  runId?: number | null;
  status?: ReleaseRecoveryStatus;
  detail?: string | null;
}) {
  const result = db.prepare(`
    INSERT INTO release_recovery_attempts (
      plan_id, kind, target, action, run_row_id, workflow_id, workflow_path,
      source_run_id, run_id, status, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.planId,
    input.kind,
    input.target,
    input.action,
    input.runRowId ?? null,
    input.workflowId ?? null,
    input.workflowPath ?? null,
    input.sourceRunId ?? null,
    input.runId ?? null,
    input.status || 'requested',
    input.detail ?? null
  );
  return getAttempt(Number(result.lastInsertRowid))!;
}

function updateAttempt(id: number, values: { runId?: number | null; status?: ReleaseRecoveryStatus; detail?: string | null }) {
  const current = getAttempt(id);
  if (!current) return;
  db.prepare(`
    UPDATE release_recovery_attempts
    SET run_id = ?, status = ?, detail = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    values.runId === undefined ? current.runId : values.runId,
    values.status || current.status,
    values.detail === undefined ? current.detail : values.detail,
    id
  );
}

async function requirePlan(planId: number) {
  const plan = await getReleasePlan(planId, false);
  if (!plan) throw Object.assign(new Error('Release plan not found'), { statusCode: 404 });
  return plan;
}

function pathMatches(actual: string, expected: string) {
  return actual.endsWith(`/${expected}`) || actual.endsWith(expected);
}

function requestedAtMs(value: string) {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function resolveDispatchedRun(plan: Awaited<ReturnType<typeof requirePlan>>, attempt: ReleaseRecoveryAttempt) {
  if (attempt.runId || !attempt.workflowId) return attempt.runId;
  const recent = await listRunsForWorkflow(plan.project, attempt.workflowId, 20);
  const floor = requestedAtMs(attempt.requestedAt) - 15_000;
  const candidate = recent
    .filter((run) => run.headBranch === plan.tagName && run.headSha === plan.sourceSha && new Date(run.createdAt).getTime() >= floor)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!candidate) return null;
  updateAttempt(attempt.id, { runId: candidate.id, status: candidate.status === 'completed' ? 'requested' : 'running', detail: `已绑定 Workflow Run #${candidate.runNumber}` });
  return candidate.id;
}

async function syncWorkflowRecovery(attempt: ReleaseRecoveryAttempt) {
  if (!attempt.runRowId) return;
  const row = db.prepare('SELECT status, conclusion, run_number FROM release_plan_runs WHERE id = ?').get(attempt.runRowId) as any;
  if (!row) return updateAttempt(attempt.id, { status: 'failed', detail: '原发布流水线记录已不存在' });
  if (row.status !== 'completed') {
    return updateAttempt(attempt.id, { status: 'running', detail: `恢复中的 Workflow${row.run_number ? ` #${row.run_number}` : ''}` });
  }
  if (row.conclusion === 'success') {
    return updateAttempt(attempt.id, { status: 'success', detail: `Workflow${row.run_number ? ` #${row.run_number}` : ''} 恢复成功` });
  }
  return updateAttempt(attempt.id, { status: 'failed', detail: `Workflow 恢复后仍为 ${row.conclusion || 'failed'}` });
}

async function syncChannelRecovery(plan: Awaited<ReturnType<typeof requirePlan>>, attempt: ReleaseRecoveryAttempt, channels: Channel[]) {
  const runId = await resolveDispatchedRun(plan, attempt);
  if (!runId) return updateAttempt(attempt.id, { status: 'requested', detail: '已请求渠道恢复，等待 GitHub 创建 Workflow Run' });

  let run;
  try {
    run = await getWorkflowRun(plan.project, runId);
  } catch {
    return;
  }
  if (run.status !== 'completed') {
    return updateAttempt(attempt.id, { status: 'running', detail: `Workflow #${run.runNumber} 正在执行` });
  }
  if (run.conclusion !== 'success') {
    return updateAttempt(attempt.id, { status: 'failed', detail: `Workflow #${run.runNumber} ${run.conclusion || '失败'}` });
  }

  const channel = channels.find((item) => item.kind === attempt.kind);
  if (!channel) return updateAttempt(attempt.id, { status: 'success', detail: `Workflow #${run.runNumber} 已成功；该项目没有额外平台验证器` });
  if (channel.status === 'success') {
    return updateAttempt(attempt.id, { status: 'success', detail: `${channel.label} 平台已确认：${channel.summary}` });
  }
  if (channel.status === 'running') {
    return updateAttempt(attempt.id, { status: 'waiting_platform', detail: `${channel.label} 仍在平台处理：${channel.summary}` });
  }

  return updateAttempt(attempt.id, {
    status: 'waiting_platform',
    detail: `Workflow #${run.runNumber} 已成功，等待平台最终确认：${channel.summary}`
  });
}

function annotateChannel(plan: Awaited<ReturnType<typeof requirePlan>>, channel: Channel) {
  const retryConfig = channel.kind === 'github' ? null : channelRetries[plan.project.slug]?.[channel.kind as Exclude<ReleaseRecoveryKind, 'workflow'>];
  const retryable = Boolean(retryConfig) && !['success', 'running'].includes(channel.status);
  const retryLabel = channel.kind === 'gitee' ? '重试 Gitee' : channel.kind === 'testflight' ? '重试 TestFlight' : channel.kind === 'dockerhub' ? '重试 Docker' : null;
  return {
    ...channel,
    retryable,
    retryLabel: retryable ? retryLabel : null,
    recheckOnly: channel.status === 'running'
  };
}

export type ReleaseRecoveryState = {
  plan: Awaited<ReturnType<typeof requirePlan>>;
  channels: Array<Channel & { retryable: boolean; retryLabel: string | null; recheckOnly: boolean }>;
  recoveries: ReleaseRecoveryAttempt[];
};

async function syncReleaseRecoveryStateUnsafe(planId: number): Promise<ReleaseRecoveryState | undefined> {
  const plan = await getReleasePlan(planId, true);
  if (!plan) return undefined;
  const versionState = await buildReleaseVersionChannels(plan.project, plan.version);
  const active = listAttempts(planId).filter((attempt) => ['requested', 'running', 'waiting_platform'].includes(attempt.status));

  for (const attempt of active) {
    try {
      if (attempt.kind === 'workflow') await syncWorkflowRecovery(attempt);
      else await syncChannelRecovery(plan, attempt, versionState.channels);
    } catch (error) {
      updateAttempt(attempt.id, { detail: error instanceof Error ? error.message : 'Recovery sync failed' });
    }
  }

  const refreshedPlan = await getReleasePlan(planId, false);
  if (!refreshedPlan) return undefined;
  return {
    plan: refreshedPlan,
    channels: versionState.channels.map((channel) => annotateChannel(refreshedPlan, channel)),
    recoveries: listAttempts(planId)
  };
}

export function getReleaseRecoveryState(planId: number) {
  const existing = activeRecoverySyncs.get(planId);
  if (existing) return existing;
  const promise = syncReleaseRecoveryStateUnsafe(planId).finally(() => activeRecoverySyncs.delete(planId));
  activeRecoverySyncs.set(planId, promise);
  return promise;
}

export async function retryFailedReleasePlanRuns(planId: number) {
  if (!githubConfigured) throw Object.assign(new Error('GITHUB_TOKEN is not configured on the server'), { statusCode: 409 });
  const plan = await requirePlan(planId);
  const failedRuns = plan.runs.filter((run) => run.dispatchState === 'failed' || (run.status === 'completed' && run.conclusion !== 'success'));
  if (!failedRuns.length) throw Object.assign(new Error('该发布计划没有可重试的失败流水线'), { statusCode: 409 });

  let requested = 0;
  let waitingForRun = false;
  for (const run of failedRuns) {
    try {
      if (run.runId) {
        if (run.conclusion === 'cancelled') {
          await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun', {
            owner: plan.project.owner, repo: plan.project.repo, run_id: run.runId
          });
          insertAttempt({ planId, kind: 'workflow', target: run.role, action: 'rerun-workflow', runRowId: run.id, workflowId: run.workflowId, workflowPath: run.workflowPath, sourceRunId: run.runId, runId: run.runId, detail: '重新运行整个已取消 Workflow' });
        } else {
          await rerunFailed(plan.project, run.runId);
          insertAttempt({ planId, kind: 'workflow', target: run.role, action: 'rerun-failed-jobs', runRowId: run.id, workflowId: run.workflowId, workflowPath: run.workflowPath, sourceRunId: run.runId, runId: run.runId, detail: '仅重新运行失败 Job' });
        }
        db.prepare("UPDATE release_plan_runs SET status = 'queued', conclusion = NULL, dispatch_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.id);
      } else {
        await dispatchWorkflow(plan.project, run.workflowId, plan.tagName, run.dispatchInputs);
        insertAttempt({ planId, kind: 'workflow', target: run.role, action: 'workflow-dispatch', runRowId: run.id, workflowId: run.workflowId, workflowPath: run.workflowPath, detail: '重新 dispatch 原发布 Workflow' });
        db.prepare(`
          UPDATE release_plan_runs
          SET dispatch_state = 'manual', dispatch_error = NULL, run_id = NULL, run_number = NULL,
              status = NULL, conclusion = NULL, run_url = NULL, manifest_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(run.id);
        waitingForRun = true;
      }
      requested += 1;
    } catch (error) {
      insertAttempt({
        planId, kind: 'workflow', target: run.role, action: run.runId ? 'rerun-failed-jobs' : 'workflow-dispatch',
        runRowId: run.id, workflowId: run.workflowId, workflowPath: run.workflowPath, sourceRunId: run.runId,
        runId: run.runId, status: 'failed', detail: error instanceof Error ? error.message : 'Retry request failed'
      });
    }
  }

  if (!requested) throw Object.assign(new Error('失败流水线重试请求全部失败'), { statusCode: 502 });
  db.prepare(`
    UPDATE release_plans
    SET status = ?, error_message = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(waitingForRun ? 'WAITING_RUNS' : 'RUNNING', planId);
  return getReleaseRecoveryState(planId);
}

export async function retryReleaseChannel(planId: number, kind: Exclude<ReleaseRecoveryKind, 'workflow'>) {
  if (!githubConfigured) throw Object.assign(new Error('GITHUB_TOKEN is not configured on the server'), { statusCode: 409 });
  const plan = await requirePlan(planId);
  const config = channelRetries[plan.project.slug]?.[kind];
  if (!config) throw Object.assign(new Error(`${plan.project.displayName} 暂不支持单独重试 ${kind} 渠道`), { statusCode: 422 });

  const state = await getReleaseRecoveryState(planId);
  const channel = state?.channels.find((item) => item.kind === kind);
  if (channel?.status === 'success') throw Object.assign(new Error(`${channel.label} 已经是成功状态，不需要重试`), { statusCode: 409 });
  if (channel?.status === 'running') throw Object.assign(new Error(`${channel.label} 仍在平台处理中，请直接重新检查状态，不要重复上传`), { statusCode: 409 });

  const workflows = await listWorkflows(plan.project);
  const workflow = workflows.find((item) => pathMatches(item.path, config.path));
  if (!workflow) throw Object.assign(new Error(`未找到渠道恢复 Workflow: ${config.path}`), { statusCode: 404 });
  const schema = await getWorkflowSchema(plan.project, String(workflow.id));
  if (!schema.dispatchable) throw Object.assign(new Error(`${workflow.name} 不支持 workflow_dispatch`), { statusCode: 422 });

  const inputs = config.inputs(plan.version);
  await dispatchWorkflow(plan.project, String(workflow.id), plan.tagName, inputs);
  insertAttempt({
    planId,
    kind,
    target: channel?.label || kind,
    action: 'workflow-dispatch',
    workflowId: String(workflow.id),
    workflowPath: workflow.path,
    detail: `已用 ${plan.tagName} 重新触发 ${workflow.name}`
  });
  return getReleaseRecoveryState(planId);
}

export function startReleaseRecoveryWatcher(log?: FastifyBaseLogger) {
  let stopped = false;
  let ticking = false;

  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const planIds = listActiveRecoveryPlanIds();
      await Promise.all(planIds.map(async (planId) => {
        try {
          await getReleaseRecoveryState(planId);
        } catch (error) {
          log?.debug({ err: error, releasePlanId: planId }, 'release recovery sync failed');
        }
      }));
    } finally {
      ticking = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), RECOVERY_POLL_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
