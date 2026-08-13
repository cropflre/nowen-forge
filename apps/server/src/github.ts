import { Octokit } from '@octokit/rest';
import { parse } from 'yaml';
import type { Project } from './db.js';

const token = process.env.GITHUB_TOKEN?.trim();
export const githubConfigured = Boolean(token);
export const octokit = new Octokit(token ? { auth: token } : {});

export type WorkflowInput = {
  name: string;
  description: string;
  required: boolean;
  defaultValue: string;
  type: 'string' | 'choice' | 'boolean' | 'number' | 'environment';
  options: string[];
};

export async function listWorkflows(project: Project) {
  const { data } = await octokit.rest.actions.listRepoWorkflows({ owner: project.owner, repo: project.repo, per_page: 100 });
  return data.workflows
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
      recommended: project.workflowHints.some((hint) => workflow.path.endsWith(`/${hint}`) || workflow.path.endsWith(hint))
    }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
}

export async function listRefs(project: Project) {
  const [{ data: branches }, { data: tags }] = await Promise.all([
    octokit.rest.repos.listBranches({ owner: project.owner, repo: project.repo, per_page: 100 }),
    octokit.rest.repos.listTags({ owner: project.owner, repo: project.repo, per_page: 100 })
  ]);
  return {
    branches: branches.map((branch) => branch.name),
    tags: tags.map((tag) => tag.name)
  };
}

export async function getRepo(project: Project) {
  const { data } = await octokit.rest.repos.get({ owner: project.owner, repo: project.repo });
  return { defaultBranch: data.default_branch, private: data.private, htmlUrl: data.html_url };
}

export async function resolveCommit(project: Project, ref: string) {
  const { data } = await octokit.rest.repos.getCommit({ owner: project.owner, repo: project.repo, ref });
  return { sha: data.sha, htmlUrl: data.html_url };
}

export async function getTagCommit(project: Project, tagName: string) {
  try {
    await octokit.rest.git.getRef({ owner: project.owner, repo: project.repo, ref: `tags/${tagName}` });
    const commit = await resolveCommit(project, tagName);
    return { exists: true as const, sha: commit.sha };
  } catch (error) {
    if ((error as { status?: number })?.status === 404) return { exists: false as const, sha: null };
    throw error;
  }
}

export async function createTagRef(project: Project, tagName: string, sha: string) {
  const { data } = await octokit.rest.git.createRef({
    owner: project.owner,
    repo: project.repo,
    ref: `refs/tags/${tagName}`,
    sha
  });
  return { ref: data.ref, sha: data.object.sha };
}

export async function getWorkflowSchema(project: Project, workflowId: string) {
  const workflows = await listWorkflows(project);
  const workflow = workflows.find((item) => String(item.id) === String(workflowId));
  if (!workflow) throw Object.assign(new Error('Workflow not found'), { statusCode: 404 });

  const { data } = await octokit.rest.repos.getContent({ owner: project.owner, repo: project.repo, path: workflow.path });
  if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
    throw Object.assign(new Error('Workflow source cannot be read'), { statusCode: 422 });
  }

  const source = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const document = parse(source) as any;
  const trigger = document?.on;
  const dispatchConfig = getDispatchConfig(trigger);
  const dispatchable = dispatchConfig !== null;
  const inputsObject = dispatchConfig && typeof dispatchConfig === 'object' ? dispatchConfig.inputs : undefined;
  const inputs = normalizeInputs(inputsObject);
  const warnings: string[] = [];

  if (!dispatchable) warnings.push('该 Workflow 没有 workflow_dispatch 触发器，不能从 Nowen Forge 手动启动。');
  if (/if:\s*startsWith\(github\.ref,\s*['"]refs\/tags\//.test(source)) {
    warnings.push('检测到 tag-only Job 条件：从普通分支手动运行时，部分构建/发布 Job 可能会被跳过。');
  }
  if (/push:\s*[\s\S]{0,180}?tags:/m.test(source) && dispatchable) {
    warnings.push('该流水线同时支持 Tag 自动触发；正式发版前请确认手动运行和 Tag 发版的行为是否一致。');
  }

  return {
    workflowId: workflow.id,
    name: workflow.name,
    path: workflow.path,
    dispatchable,
    sourceSha: data.sha,
    inputs,
    warnings
  };
}

function getDispatchConfig(trigger: any): any | null {
  if (trigger === 'workflow_dispatch') return {};
  if (Array.isArray(trigger)) return trigger.includes('workflow_dispatch') ? {} : null;
  if (!trigger || typeof trigger !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(trigger, 'workflow_dispatch')) return null;
  return trigger.workflow_dispatch ?? {};
}

function normalizeInputs(value: any): WorkflowInput[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([name, raw]) => {
    const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
    const rawType = String(config.type || 'string');
    const type: WorkflowInput['type'] = ['choice', 'boolean', 'number', 'environment'].includes(rawType)
      ? rawType as WorkflowInput['type']
      : 'string';
    return {
      name,
      description: String(config.description || ''),
      required: Boolean(config.required),
      defaultValue: config.default === undefined || config.default === null ? '' : String(config.default),
      type,
      options: Array.isArray(config.options) ? config.options.map(String) : []
    };
  });
}

export async function listRuns(project: Project, perPage = 10) {
  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner: project.owner, repo: project.repo, per_page: Math.min(perPage, 50) });
  return data.workflow_runs.map(mapRun);
}

export async function listRunsForWorkflow(project: Project, workflowId: number | string, perPage = 5) {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
    owner: project.owner,
    repo: project.repo,
    workflow_id: workflowId,
    per_page: Math.min(perPage, 20)
  });
  return data.workflow_runs.map(mapRun);
}

export async function getWorkflowRun(project: Project, runId: number) {
  const { data } = await octokit.rest.actions.getWorkflowRun({ owner: project.owner, repo: project.repo, run_id: runId });
  return mapRun(data);
}

export async function listGithubReleases(project: Project, perPage = 10) {
  const { data } = await octokit.rest.repos.listReleases({ owner: project.owner, repo: project.repo, per_page: Math.min(perPage, 30) });
  return data.map((release) => ({
    id: release.id,
    tagName: release.tag_name,
    name: release.name || release.tag_name,
    draft: release.draft,
    prerelease: release.prerelease,
    createdAt: release.created_at,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    assets: release.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      downloadCount: asset.download_count,
      browserDownloadUrl: asset.browser_download_url
    }))
  }));
}

export async function dispatchWorkflow(project: Project, workflowId: string, ref: string, inputs: Record<string, string>) {
  await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner: project.owner,
    repo: project.repo,
    workflow_id: workflowId,
    ref,
    inputs
  });
}

function mapArtifact(artifact: any) {
  return {
    id: Number(artifact.id),
    name: String(artifact.name),
    sizeInBytes: Number(artifact.size_in_bytes || 0),
    digest: typeof artifact.digest === 'string' ? artifact.digest : null,
    expired: Boolean(artifact.expired),
    createdAt: artifact.created_at || null,
    expiresAt: artifact.expires_at || null,
    archiveDownloadUrl: artifact.archive_download_url
  };
}

export async function getRunDetails(project: Project, runId: number) {
  const [{ data: run }, { data: jobs }, { data: artifacts }] = await Promise.all([
    octokit.rest.actions.getWorkflowRun({ owner: project.owner, repo: project.repo, run_id: runId }),
    octokit.rest.actions.listJobsForWorkflowRun({ owner: project.owner, repo: project.repo, run_id: runId, per_page: 100 }),
    octokit.rest.actions.listWorkflowRunArtifacts({ owner: project.owner, repo: project.repo, run_id: runId, per_page: 100 })
  ]);

  return {
    run: mapRun(run),
    jobs: jobs.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      htmlUrl: job.html_url,
      steps: job.steps?.map((step) => ({ name: step.name, status: step.status, conclusion: step.conclusion, number: step.number })) || []
    })),
    artifacts: artifacts.artifacts.map(mapArtifact)
  };
}

export async function getArtifact(project: Project, artifactId: number) {
  const { data } = await octokit.rest.actions.getArtifact({ owner: project.owner, repo: project.repo, artifact_id: artifactId });
  return mapArtifact(data);
}

export async function downloadArtifactArchive(project: Project, artifactId: number) {
  if (!token) throw Object.assign(new Error('GITHUB_TOKEN is required to download Actions artifacts'), { statusCode: 409 });
  const artifact = await getArtifact(project, artifactId);
  if (artifact.expired) throw Object.assign(new Error('Artifact has expired on GitHub'), { statusCode: 410 });
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/artifacts/${artifactId}/zip`, {
    redirect: 'follow',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Nowen-Forge/0.5'
    }
  });
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`GitHub artifact download failed: HTTP ${response.status}`), { statusCode: response.status || 502 });
  }
  return { artifact, response };
}

export async function rerunFailed(project: Project, runId: number) {
  await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', {
    owner: project.owner,
    repo: project.repo,
    run_id: runId
  });
}

export async function cancelRun(project: Project, runId: number) {
  await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {
    owner: project.owner,
    repo: project.repo,
    run_id: runId
  });
}

export function mapRun(run: any) {
  return {
    id: run.id,
    name: run.name,
    displayTitle: run.display_title,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    workflowId: run.workflow_id,
    runNumber: run.run_number,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    actor: run.actor?.login || null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url
  };
}
