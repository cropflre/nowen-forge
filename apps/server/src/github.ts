import { Octokit } from '@octokit/rest';
import type { Project } from './db.js';

const token = process.env.GITHUB_TOKEN?.trim();
export const githubConfigured = Boolean(token);
export const octokit = new Octokit(token ? { auth: token } : {});

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

export async function listBranches(project: Project) {
  const { data } = await octokit.rest.repos.listBranches({ owner: project.owner, repo: project.repo, per_page: 100 });
  return data.map((branch) => branch.name);
}

export async function getRepo(project: Project) {
  const { data } = await octokit.rest.repos.get({ owner: project.owner, repo: project.repo });
  return { defaultBranch: data.default_branch, private: data.private, htmlUrl: data.html_url };
}

export async function listRuns(project: Project, perPage = 10) {
  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner: project.owner, repo: project.repo, per_page: Math.min(perPage, 50) });
  return data.workflow_runs.map(mapRun);
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
    artifacts: artifacts.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      expired: artifact.expired,
      createdAt: artifact.created_at,
      expiresAt: artifact.expires_at,
      archiveDownloadUrl: artifact.archive_download_url
    }))
  };
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

function mapRun(run: any) {
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
