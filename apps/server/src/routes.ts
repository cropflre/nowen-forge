import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProject, listProjects, recordDispatch } from './db.js';
import { cancelRun, dispatchWorkflow, getRepo, getRunDetails, getWorkflowSchema, githubConfigured, listRefs, listRuns, listWorkflows, rerunFailed } from './github.js';
import { buildReleaseCenter } from './releases.js';

const dispatchSchema = z.object({
  ref: z.string().min(1),
  inputs: z.record(z.string()).default({})
});

function requireProject(id: string) {
  const project = getProject(Number(id));
  if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  return project;
}

export async function registerApi(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, githubConfigured, version: '0.2.0' }));

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
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/projects/:id/runs/:runId/rerun-failed', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id, runId } = request.params as { id: string; runId: string };
    await rerunFailed(requireProject(id), Number(runId));
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/projects/:id/runs/:runId/cancel', async (request, reply) => {
    if (!githubConfigured) return reply.code(409).send({ message: 'GITHUB_TOKEN is not configured on the server' });
    const { id, runId } = request.params as { id: string; runId: string };
    await cancelRun(requireProject(id), Number(runId));
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
