import type { FastifyBaseLogger } from 'fastify';
import { db, getProject, type Project } from './db.js';
import {
  createTagRef,
  dispatchWorkflow,
  getTagCommit,
  getWorkflowRun,
  getWorkflowSchema,
  githubConfigured,
  listRunsForWorkflow,
  listWorkflows,
  resolveCommit
} from './github.js';
import { createManifestFromRun } from './manifests.js';

export type ReleasePlanStatus = 'PREPARING' | 'WAITING_RUNS' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type ReleasePlanDispatchState = 'pending' | 'auto' | 'manual' | 'fallback' | 'failed';

export type ReleasePlanRun = {
  id: number;
  workflowId: string;
  workflowPath: string;
  workflowName: string;
  role: string;
  required: boolean;
  dispatchInputs: Record<string, string>;
  dispatchState: ReleasePlanDispatchState;
  dispatchError: string | null;
  runId: number | null;
  runNumber: number | null;
  status: string | null;
  conclusion: string | null;
  runUrl: string | null;
  manifestId: number | null;
  updatedAt: string;
};

export type ReleasePlan = {
  id: number;
  project: Project;
  version: string;
  sourceRef: string;
  sourceSha: string;
  sourceUrl: string;
  tagName: string;
  strategy: 'tag-auto-with-dispatch-fallback' | 'tag-dispatch';
  status: ReleasePlanStatus;
  tagCreated: boolean;
  tagReused: boolean;
  warnings: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  runs: ReleasePlanRun[];
};

type WorkflowBlueprint = {
  path: string;
  role: string;
  required: boolean;
  inputs: (version: string) => Record<string, string>;
};

type ReleaseStrategy = {
  autoTag: boolean;
  workflows: WorkflowBlueprint[];
  warnings?: string[];
};

const AUTO_DISPATCH_FALLBACK_MS = 20_000;
const RELEASE_PLAN_POLL_MS = 8_000;
const activeSyncs = new Map<number, Promise<ReleasePlan | undefined>>();

const strategies: Record<string, ReleaseStrategy> = {
  'nowen-note': {
    autoTag: true,
    workflows: [
      { path: 'release.yml', role: 'Desktop Release', required: true, inputs: () => ({ publish: 'always' }) },
      { path: 'ios-release.yml', role: 'iOS / TestFlight', required: true, inputs: () => ({ upload: 'true' }) }
    ]
  },
  'nowen-video': {
    autoTag: true,
    workflows: [
      {
        path: 'release-desktop.yml',
        role: 'Desktop Release',
        required: true,
        inputs: (version) => ({ version_name: version.replace(/^v/, ''), target: 'windows' })
      }
    ],
    warnings: ['当前 nowen-video 桌面正式构建矩阵仍只有 Windows；macOS / Linux 尚未进入正式 Release matrix。']
  },
  'nowen-reader': {
    autoTag: false,
    workflows: [
      { path: 'build.yml', role: 'Go + Docker + GitHub Release', required: true, inputs: () => ({}) }
    ],
    warnings: ['nowen-reader 的正式 Job 是 tag-only，因此 Forge 会创建 Tag 后，以该 Tag 作为 workflow_dispatch.ref 手动启动。']
  },
  NOWEN: {
    autoTag: false,
    workflows: [
      { path: 'docker-publish.yml', role: 'Docker multi-arch', required: true, inputs: () => ({}) }
    ],
    warnings: ['NOWEN 当前 Docker Workflow 只推 latest 与 commit SHA，不推版本号 Tag；发布计划成功后，Manifest 的 Docker 渠道仍可能显示版本不匹配。']
  }
};

db.exec(`
  CREATE TABLE IF NOT EXISTS release_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    source_sha TEXT NOT NULL,
    source_url TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    tag_created INTEGER NOT NULL DEFAULT 0,
    tag_reused INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    UNIQUE(project_id, version)
  );

  CREATE TABLE IF NOT EXISTS release_plan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES release_plans(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL,
    workflow_path TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    role TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    dispatch_inputs_json TEXT NOT NULL DEFAULT '{}',
    dispatch_state TEXT NOT NULL DEFAULT 'pending',
    dispatch_error TEXT,
    run_id INTEGER,
    run_number INTEGER,
    status TEXT,
    conclusion TEXT,
    run_url TEXT,
    manifest_id INTEGER REFERENCES release_manifests(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_id, workflow_path)
  );

  CREATE INDEX IF NOT EXISTS idx_release_plans_status ON release_plans(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_release_plans_project ON release_plans(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_release_plan_runs_plan ON release_plan_runs(plan_id, id);
`);

function canonicalVersion(input: string) {
  const body = input.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(body)) {
    throw Object.assign(new Error('版本号必须是 1.2.3 或 1.2.3-rc.1 这类 SemVer；Forge 会自动补 v 前缀'), { statusCode: 400 });
  }
  return `v${body}`;
}

function strategyFor(project: Project) {
  return strategies[project.slug];
}

function pathMatches(actual: string, expected: string) {
  return actual.endsWith(`/${expected}`) || actual.endsWith(expected);
}

function getPlanRuns(planId: number): ReleasePlanRun[] {
  return (db.prepare('SELECT * FROM release_plan_runs WHERE plan_id = ? ORDER BY id').all(planId) as any[]).map((row) => ({
    id: Number(row.id),
    workflowId: String(row.workflow_id),
    workflowPath: row.workflow_path,
    workflowName: row.workflow_name,
    role: row.role,
    required: Boolean(row.required),
    dispatchInputs: JSON.parse(row.dispatch_inputs_json || '{}'),
    dispatchState: row.dispatch_state as ReleasePlanDispatchState,
    dispatchError: row.dispatch_error || null,
    runId: row.run_id == null ? null : Number(row.run_id),
    runNumber: row.run_number == null ? null : Number(row.run_number),
    status: row.status || null,
    conclusion: row.conclusion || null,
    runUrl: row.run_url || null,
    manifestId: row.manifest_id == null ? null : Number(row.manifest_id),
    updatedAt: row.updated_at
  }));
}

function mapPlan(row: any): ReleasePlan {
  const project = getProject(Number(row.project_id));
  if (!project) throw new Error(`Project ${row.project_id} not found for release plan`);
  return {
    id: Number(row.id),
    project,
    version: row.version,
    sourceRef: row.source_ref,
    sourceSha: row.source_sha,
    sourceUrl: row.source_url,
    tagName: row.tag_name,
    strategy: row.strategy,
    status: row.status,
    tagCreated: Boolean(row.tag_created),
    tagReused: Boolean(row.tag_reused),
    warnings: JSON.parse(row.warnings_json || '[]'),
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    runs: getPlanRuns(Number(row.id))
  };
}

function getPlanRaw(id: number): ReleasePlan | undefined {
  const row = db.prepare('SELECT * FROM release_plans WHERE id = ?').get(id);
  return row ? mapPlan(row) : undefined;
}

function findPlanByVersion(projectId: number, version: string): ReleasePlan | undefined {
  const row = db.prepare('SELECT * FROM release_plans WHERE project_id = ? AND version = ?').get(projectId, version);
  return row ? mapPlan(row) : undefined;
}

function listPlansRaw(limit = 50): ReleasePlan[] {
  return (db.prepare('SELECT * FROM release_plans ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map(mapPlan);
}

function listActivePlanIds() {
  return (db.prepare("SELECT id FROM release_plans WHERE status IN ('PREPARING','WAITING_RUNS','RUNNING') ORDER BY created_at").all() as any[]).map((row) => Number(row.id));
}

function setPlanStatus(id: number, status: ReleasePlanStatus, errorMessage?: string | null) {
  const terminal = ['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(status);
  db.prepare(`
    UPDATE release_plans
    SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END
    WHERE id = ?
  `).run(status, errorMessage ?? null, terminal ? 1 : 0, id);
}

function updatePlanRunFromGithub(rowId: number, run: any, dispatchState?: ReleasePlanDispatchState) {
  db.prepare(`
    UPDATE release_plan_runs
    SET run_id = ?, run_number = ?, status = ?, conclusion = ?, run_url = ?,
        dispatch_state = COALESCE(?, dispatch_state), dispatch_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(run.id, run.runNumber, run.status, run.conclusion, run.htmlUrl, dispatchState ?? null, rowId);
}

function setRunManifest(rowId: number, manifestId: number) {
  db.prepare('UPDATE release_plan_runs SET manifest_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(manifestId, rowId);
}

function setDispatchFailure(rowId: number, message: string) {
  db.prepare(`
    UPDATE release_plan_runs
    SET dispatch_state = 'failed', dispatch_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(message, rowId);
}

async function dispatchPlanRun(project: Project, plan: ReleasePlan, run: ReleasePlanRun, state: 'manual' | 'fallback') {
  try {
    await dispatchWorkflow(project, run.workflowId, plan.tagName, run.dispatchInputs);
    db.prepare(`
      UPDATE release_plan_runs
      SET dispatch_state = ?, dispatch_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(state, run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'workflow_dispatch failed';
    setDispatchFailure(run.id, message);
    throw error;
  }
}

export async function preflightRelease(project: Project, inputVersion: string, sourceRef: string) {
  const version = canonicalVersion(inputVersion);
  const strategy = strategyFor(project);
  const blockingReasons: string[] = [];
  const warnings = [...(strategy?.warnings || [])];

  if (!strategy) blockingReasons.push('该项目还没有配置一键发布策略。');
  if (!githubConfigured) blockingReasons.push('服务端未配置 GITHUB_TOKEN，不能创建 Tag 或触发发布流水线。');

  const source = await resolveCommit(project, sourceRef.trim());
  const tag = await getTagCommit(project, version);
  if (tag.exists && tag.sha !== source.sha) {
    blockingReasons.push(`Tag ${version} 已存在，但指向 ${tag.sha?.slice(0, 12)}，与当前来源 ${source.sha.slice(0, 12)} 不一致。`);
  } else if (tag.exists) {
    warnings.push(`Tag ${version} 已存在且指向同一 Commit；Forge 会复用该 Tag，并直接 dispatch 未完成的发布流水线。`);
  }

  const existingPlan = findPlanByVersion(project.id, version);
  if (existingPlan) blockingReasons.push(`该项目的 ${version} 已存在发布计划 #${existingPlan.id}，请继续查看原计划，不重复创建。`);

  const available = await listWorkflows(project);
  const workflows = strategy
    ? await Promise.all(strategy.workflows.map(async (blueprint) => {
        const workflow = available.find((item) => pathMatches(item.path, blueprint.path));
        if (!workflow) {
          blockingReasons.push(`未找到 ${blueprint.path}。`);
          return {
            workflowId: null,
            workflowPath: blueprint.path,
            workflowName: blueprint.path,
            role: blueprint.role,
            required: blueprint.required,
            dispatchable: false,
            inputs: blueprint.inputs(version)
          };
        }
        let dispatchable = false;
        try {
          const schema = await getWorkflowSchema(project, String(workflow.id));
          dispatchable = schema.dispatchable;
        } catch {
          dispatchable = false;
        }
        if (!dispatchable) blockingReasons.push(`${workflow.name} 缺少 workflow_dispatch，Forge 无法做 Tag 触发兜底。`);
        return {
          workflowId: workflow.id,
          workflowPath: workflow.path,
          workflowName: workflow.name,
          role: blueprint.role,
          required: blueprint.required,
          dispatchable,
          inputs: blueprint.inputs(version)
        };
      }))
    : [];

  return {
    project,
    version,
    tagName: version,
    sourceRef: sourceRef.trim(),
    sourceSha: source.sha,
    sourceUrl: source.htmlUrl,
    strategy: strategy?.autoTag ? 'tag-auto-with-dispatch-fallback' as const : 'tag-dispatch' as const,
    tag: {
      exists: tag.exists,
      sha: tag.sha,
      matchesSource: tag.exists ? tag.sha === source.sha : null
    },
    workflows,
    warnings,
    blockingReasons,
    existingPlan: existingPlan ? { id: existingPlan.id, status: existingPlan.status } : null,
    canStart: blockingReasons.length === 0
  };
}

export async function startReleasePlan(project: Project, inputVersion: string, sourceRef: string) {
  const preflight = await preflightRelease(project, inputVersion, sourceRef);
  if (!preflight.canStart) {
    throw Object.assign(new Error(preflight.blockingReasons[0] || 'Release preflight failed'), { statusCode: 409 });
  }

  const strategy = strategyFor(project)!;
  const tagReused = preflight.tag.exists;
  let tagCreated = false;
  if (!tagReused) {
    await createTagRef(project, preflight.tagName, preflight.sourceSha);
    tagCreated = true;
  }

  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO release_plans (
        project_id, version, source_ref, source_sha, source_url, tag_name, strategy, status,
        tag_created, tag_reused, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PREPARING', ?, ?, ?)
    `).run(
      project.id,
      preflight.version,
      preflight.sourceRef,
      preflight.sourceSha,
      preflight.sourceUrl,
      preflight.tagName,
      preflight.strategy,
      tagCreated ? 1 : 0,
      tagReused ? 1 : 0,
      JSON.stringify(preflight.warnings)
    );
    const planId = Number(result.lastInsertRowid);
    const insertRun = db.prepare(`
      INSERT INTO release_plan_runs (
        plan_id, workflow_id, workflow_path, workflow_name, role, required, dispatch_inputs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const workflow of preflight.workflows) {
      insertRun.run(
        planId,
        String(workflow.workflowId),
        workflow.workflowPath,
        workflow.workflowName,
        workflow.role,
        workflow.required ? 1 : 0,
        JSON.stringify(workflow.inputs)
      );
    }
    return planId;
  });

  const planId = transaction();
  let plan = getPlanRaw(planId)!;

  try {
    if (!strategy.autoTag || tagReused) {
      for (const run of plan.runs) await dispatchPlanRun(project, plan, run, 'manual');
    }
    setPlanStatus(planId, 'WAITING_RUNS');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to dispatch release workflow';
    setPlanStatus(planId, 'FAILED', message);
    throw Object.assign(new Error(message), { statusCode: (error as any)?.statusCode || 502, planId });
  }

  plan = getPlanRaw(planId)!;
  return plan;
}

async function syncReleasePlanUnsafe(id: number): Promise<ReleasePlan | undefined> {
  let plan = getPlanRaw(id);
  if (!plan || ['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(plan.status)) return plan;
  const project = plan.project;
  const strategy = strategyFor(project);
  if (!strategy) {
    setPlanStatus(id, 'FAILED', 'Release strategy no longer exists');
    return getPlanRaw(id);
  }

  const floor = new Date(plan.createdAt).getTime() - 90_000;
  const allowFallback = strategy.autoTag && Date.now() - new Date(plan.createdAt).getTime() >= AUTO_DISPATCH_FALLBACK_MS;

  for (const current of plan.runs) {
    let row = current;
    if (row.dispatchState === 'failed') continue;

    if (!row.runId) {
      const recent = await listRunsForWorkflow(project, row.workflowId, 15);
      const candidate = recent
        .filter((run) => run.headBranch === plan!.tagName && run.headSha === plan!.sourceSha && new Date(run.createdAt).getTime() >= floor)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

      if (candidate) {
        const inferredState: ReleasePlanDispatchState | undefined = row.dispatchState === 'pending' ? 'auto' : undefined;
        updatePlanRunFromGithub(row.id, candidate, inferredState);
      } else if (allowFallback && row.dispatchState === 'pending') {
        try {
          await dispatchPlanRun(project, plan, row, 'fallback');
        } catch {
          // The failed state is persisted on the row; final plan state is calculated below.
        }
      }
    } else {
      try {
        const run = await getWorkflowRun(project, row.runId);
        updatePlanRunFromGithub(row.id, run);
      } catch {
        // Keep the last known snapshot; the next watcher tick can retry.
      }
    }
  }

  plan = getPlanRaw(id)!;
  for (const row of plan.runs) {
    if (row.runId && row.status === 'completed' && !row.manifestId) {
      try {
        const result = await createManifestFromRun(project, row.runId, plan.version);
        setRunManifest(row.id, result.manifest.id);
      } catch {
        // Manifest creation can be retried without changing the immutable run snapshot.
      }
    }
  }

  plan = getPlanRaw(id)!;
  const required = plan.runs.filter((run) => run.required);
  const dispatchFailed = required.some((run) => run.dispatchState === 'failed');
  const missing = required.some((run) => !run.runId);
  const running = required.some((run) => run.runId && run.status !== 'completed');

  if (dispatchFailed && !required.some((run) => run.runId && run.status !== 'completed')) {
    setPlanStatus(id, 'FAILED', required.find((run) => run.dispatchError)?.dispatchError || 'Release workflow dispatch failed');
  } else if (missing) {
    setPlanStatus(id, 'WAITING_RUNS');
  } else if (running) {
    setPlanStatus(id, 'RUNNING');
  } else {
    const successCount = required.filter((run) => run.conclusion === 'success').length;
    if (successCount === required.length) setPlanStatus(id, 'SUCCEEDED');
    else if (successCount > 0) setPlanStatus(id, 'PARTIAL');
    else setPlanStatus(id, 'FAILED', 'All required release workflows failed or were cancelled');
  }

  return getPlanRaw(id);
}

export function syncReleasePlan(id: number) {
  const existing = activeSyncs.get(id);
  if (existing) return existing;
  const promise = syncReleasePlanUnsafe(id).finally(() => activeSyncs.delete(id));
  activeSyncs.set(id, promise);
  return promise;
}

export async function getReleasePlan(id: number, sync = true) {
  return sync ? syncReleasePlan(id) : getPlanRaw(id);
}

export async function buildReleasePlanCenter() {
  const ids = listActivePlanIds();
  await Promise.all(ids.map((id) => syncReleasePlan(id)));
  const plans = listPlansRaw();
  return {
    plans,
    stats: {
      total: plans.length,
      active: plans.filter((plan) => ['PREPARING', 'WAITING_RUNS', 'RUNNING'].includes(plan.status)).length,
      succeeded: plans.filter((plan) => plan.status === 'SUCCEEDED').length,
      attention: plans.filter((plan) => ['PARTIAL', 'FAILED'].includes(plan.status)).length
    }
  };
}

export function startReleasePlanWatcher(log?: FastifyBaseLogger) {
  let stopped = false;
  let ticking = false;

  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const ids = listActivePlanIds();
      await Promise.all(ids.map(async (id) => {
        try {
          await syncReleasePlan(id);
        } catch (error) {
          log?.debug({ err: error, releasePlanId: id }, 'release plan sync failed');
        }
      }));
    } finally {
      ticking = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), RELEASE_PLAN_POLL_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
