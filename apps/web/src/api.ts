import type { ReleaseCenter, WorkflowSchema } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  dashboard: () => request<any>('/api/dashboard'),
  projects: () => request<any>('/api/projects'),
  meta: (id: number) => request<any>(`/api/projects/${id}/meta`),
  workflows: (id: number) => request<any>(`/api/projects/${id}/workflows`),
  workflowSchema: (projectId: number, workflowId: number) => request<WorkflowSchema>(`/api/projects/${projectId}/workflows/${workflowId}/schema`),
  branches: (id: number) => request<{ branches: string[]; tags: string[] }>(`/api/projects/${id}/branches`),
  runs: (id: number) => request<any>(`/api/projects/${id}/runs?limit=30`),
  run: (projectId: number, runId: number) => request<any>(`/api/projects/${projectId}/runs/${runId}`),
  dispatch: (projectId: number, workflowId: number, ref: string, inputs: Record<string, string>) => request(`/api/projects/${projectId}/workflows/${workflowId}/dispatch`, { method: 'POST', body: JSON.stringify({ ref, inputs }) }),
  rerunFailed: (projectId: number, runId: number) => request(`/api/projects/${projectId}/runs/${runId}/rerun-failed`, { method: 'POST' }),
  cancel: (projectId: number, runId: number) => request(`/api/projects/${projectId}/runs/${runId}/cancel`, { method: 'POST' }),
  releaseCenter: () => request<ReleaseCenter>('/api/releases'),
  health: () => request<any>('/api/health')
};
