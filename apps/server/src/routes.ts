import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { getProject, getReleaseManifest, listProjects, recordDispatch } from './db.js';
import { cancelRun, dispatchWorkflow, downloadArtifactArchive, getRepo, getRunDetails, getWorkflowSchema, githubConfigured, listRefs, listRuns, listWorkflows, rerunFailed } from './github.js';
import { buildManifestCenter, createManifestFromRun } from './manifests.js';
import { syncManifestReleaseEvidence, withReleaseEvidence } from './releaseEvidence.js';
import { buildReleaseCenter } from './releases.js';
import { buildReleasePlanCenter, getReleasePlan, preflightRelease, startReleasePlan } from './releasePlans.js';
import { getPollIntervalMs, publishRealtime, webhookConfigured } from './realtime.js';

const dispatchSchema = z.object({
  ref: z.string().min(1),
  inputs: z.record(z.string()).default({})
});

const manifestSchema = z.object({
  version: z.string().trim().min(1).max(100).optional()
});

const releasePlanSchema = z.object({
  version: z.string().trim().min(1).max(100),
  sourceRef: z.string().trim().min(1).max(200)
});

function requireProject(id: string) {
  const project = getProject(Number(id));
  if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  return project;
}

export async function registerApi(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    ok: true,
    githubConfigured,
    version: '0.6.0',
    realtime: {
      sse: true,
      webhookConfigured,
      pollIntervalMs: getPollIntervalMs()
    },
    manifests: { immutable: true, githubArtifactDigest: true, githubReleaseAssetDigest: true, appendOnlyReleaseEvidence: true },
    releaseOrchestrator: { enabled: true, persistent: true, tagPreflight: true }
  }));

  app.get('/api/projects', async () => ({ projects: listProjects() }));

  app.get('/api/projects/:id/meta', async (request) => {
    const { id } = request.params as { id: string };
    const project = requireProject(id);
    const meta = await getRepo(project);
    return { project, ...meta };
  });

  app.get('/api/projects/:id/workflows', async (request) => {
    const { id } = request.params as { id: string };
    return { workflows: await listWorkflows(requireProject(id)) };
  });

  app.get('/api/projects/:id/workflows/:workflowId/schema', async (request) => {
    const { id, workflowId } = request.params as { id: string; workflowId: string };
    return getWorkflowSchema(requireProject(id), workflowId);
  });

  app.get('/api/projects/:id/branches', async (request) => {
    const { id } = request.params as { id: string };
    return listRefs(requireProject(id));
  });

  app.get('/api/projects/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    return { runs: await listRuns(requireProject(id), Number(query.limit) || 20) };
  });

  app.get('/api/projects/:id/runs/:runId', async (request) => {
    const { id, runId } = request.params as { id: string; runId: string };
    return getRunDetails(requireProject(id), Number(runId));
  });

  app.post('/api/projects/:id/runs/:runId/manifest', async (request, reply) => {
    const { id, runId } = request.params as { id: string; runId: string };
    const project = requireProject(id);
    const body = manifestSchema.parse(request.body ?? {});
    const result = await createManifestFromRun(project, Number(runId), body.version);
    publishRealtime({
      type: 'release',
      projectId: project.id,
      projectSlug: project.slug,
      repository: `${project.owner}/${project.repo}`,
      source: 'forge',
      action: result.existed ? 'manifest-existing' : 'manifest-created'
    });
    return reply.code(result.existed ? 200 : 201).send(result);
  });

  app.get('/api/projects/:id/artifacts/:artifactId/download', async (request, reply) => {
    const { id, artifactId } = request.params as { id: string; artifactId: string };
    const project = requireProject(id);
    const { artifact, response } = await downloadArtifactArchive(project, Number(artifactId));
    const safeName = artifact.name.replace(/[^0-9A-Za-z._-]+/g, '_') || `artifact-${artifact.id}`;
    reply.header('Content-Type', response.headers.get('content-type') || 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    reply.header('Cache-Control', 'private, no-store');
    const length = response.headers.get('content-length');
    if (length) reply.header('Content-Length', length);
    return reply.send(Readable.fromWeb(response.body as any));
  });

  app.get('/api/manifests', async (request) => {
    const query = request.query as { projectId?: string };
    const parsedProjectId = query.projectId ? Number(query.projectId) : undefined;
    const projectId = typeof parsedProjectId === 'number' && Number.isFinite(parsedProjectId) ? parsedProjectId : undefined;
    return buildManifestCenter(projectId);
  });

  app.get('/api/manifests/:manifestId', async (request, reply) => {
    const { manifestId } = request.params as { manifestId: string };
    const manifest = getReleaseManifest(Number(manifestId));
    if (!manifest) return reply.code(404).send({ message: 'Manifest not found' });
    return withReleaseEvidence(manifest);
  });

  app.post('/api/manifests/:manifestId/sync-release-assets', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { manifestId } = request.params as { manifestId: string };
    const result = await syncManifestReleaseEvidence(Number(manifestId));
    const manifest = result.manifest;
    publishRealtime({
      type: 'release',
      projectId: manifest.project.id,
      projectSlug: manifest.project.slug,
      repository: `${manifest.project.owner}/${manifest.project.repo}`,
      source: 'forge',
      action: result.found ? 'release-assets-synced' : 'release-assets-not-found'
    });
    return reply.send(result);
  });

  app.post('/api/projects/:id/release/preflight', async (request) => {
    const { id } = request.params as { id: string };
    const body = releasePlanSchema.parse(request.body ?? {});
    return preflightRelease(requireProject(id), body.version, body.sourceRef);
  });

  app.post('/api/projects/:id/release/start', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id } = request.params as { id: string };
    const project = requireProject(id);
    const body = releasePlanSchema.parse(request.body ?? {});
    const plan = await startReleasePlan(project, body.version, body.sourceRef);
    publishRealtime({
      type: 'release',
      projectId: project.id,
      projectSlug: project.slug,
      repository: `${project.owner}/${project.repo}`,
      source: 'forge',
      action: `release-plan:${plan.id}:started`
    });
    return reply.code(201).send({ plan });
  });

  app.get('/api/release-plans', async () => buildReleasePlanCenter());

  app.get('/api/release-plans/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await getReleasePlan(Number(planId));
    if (!plan) return reply.code(404).send({ message: 'Release plan not found' });
    return plan;
  });

  app.post('/api/projects/:id/workflows/:workflowId/dispatch', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id, workflowId } = request.params as { id: string; workflowId: string };
    const project = requireProject(id);
    const body = dispatchSchema.parse(request.body ?? {});
    const schema = await getWorkflowSchema(project, workflowId);
    if (!schema.dispatchable) return reply.code(422).send({ message: 'This workflow does not support workflow_dispatch' });

    const declared = new Set(schema.inputs.map((input) => input.name));
    const unknown = Object.keys(body.inputs).filter((name) => !declared.has(name));
    if (unknown.length) return reply.code(400).send({ message: `Unknown workflow inputs: ${unknown.join(', ')}` });
    const missing = schema.inputs.filter((input) => input.required && !body.inputs[input.name]?.trim()).map((input) => input.name);
    if (missing.length) return reply.code(400).send({ message: `Missing required workflow inputs: ${missing.join(', ')}` });

    await dispatchWorkflow(project, workflowId, body.ref, body.inputs);
    recordDispatch(project.id, workflowId, schema.name, body.ref, body.inputs);
    publishRealtime({
      type: 'dispatch',
      projectId: project.id,
      projectSlug: project.slug,
      repository: `${project.owner}/${project.repo}`,
      source: 'forge',
      action: `workflow:${workflowId}`
    });
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/projects/:id/runs/:runId/rerun-failed', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id, runId } = request.params as { id: string; runId: string };
    const project = requireProject(id);
    await rerunFailed(project, Number(runId));
    publishRealtime({ type: 'run', projectId: project.id, projectSlug: project.slug, repository: `${project.owner}/${project.repo}`, source: 'forge', action: 'rerun-failed' });
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/projects/:id/runs/:runId/cancel', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id, runId } = request.params as { id: string; runId: string };
    const project = requireProject(id);
    await cancelRun(project, Number(runId));
    publishRealtime({ type: 'run', projectId: project.id, projectSlug: project.slug, repository: `${project.owner}/${project.repo}`, source: 'forge', action: 'cancel' });
    return reply.code(202).send({ ok: true });
  });

  app.get('/api/releases', async () => buildReleaseCenter(listProjects()));

  app.get('/api/dashboard', async () => {
    const projects = listProjects();
    const groups = await Promise.all(projects.map(async (project) => {
      try {
        const runs = await listRuns(project, 8);
        return { project, runs, error: null };
      } catch (error) {
        return { project, runs: [], error: error instanceof Error ? error.message : 'GitHub request failed' };
      }
    }));
    const latestRuns = groups.flatMap(({ project, runs }) => runs.map((run) => ({ ...run, projectId: project.id, projectSlug: project.slug, projectName: project.displayName })))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);
    const completed = latestRuns.filter((run) => run.status === 'completed');
    const succeeded = completed.filter((run) => run.conclusion === 'success').length;
    return {
      githubConfigured,
      projects: groups.map(({ project, runs, error }) => ({ ...project, latestRun: runs[0] || null, error })),
      latestRuns,
      stats: {
        projectCount: projects.length,
        recentRunCount: latestRuns.length,
        runningCount: latestRuns.filter((run) => run.status !== 'completed').length,
        successRate: completed.length ? Math.round((succeeded / completed.length) * 100) : null
      }
    };
  });
}
