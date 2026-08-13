import type { ManifestCenter, ReleaseCenter, ReleaseManifest, ReleasePlan, ReleasePlanCenter, ReleasePreflight, WorkflowSchema } from './types';

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
  manifests: (projectId?: number) => request<ManifestCenter>(`/api/manifests${projectId ? `?projectId=${projectId}` : ''}`),
  manifest: (manifestId: number) => request<ReleaseManifest>(`/api/manifests/${manifestId}`),
  createManifest: (projectId: number, runId: number, version?: string) => request<{ manifest: ReleaseManifest; existed: boolean }>(`/api/projects/${projectId}/runs/${runId}/manifest`, { method: 'POST', body: JSON.stringify(version ? { version } : {}) }),
  artifactDownloadUrl: (projectId: number, artifactId: number) => `/api/projects/${projectId}/artifacts/${artifactId}/download`,
  releasePreflight: (projectId: number, version: string, sourceRef: string) => request<ReleasePreflight>(`/api/projects/${projectId}/release/preflight`, { method: 'POST', body: JSON.stringify({ version, sourceRef }) }),
  startRelease: (projectId: number, version: string, sourceRef: string) => request<{ plan: ReleasePlan }>(`/api/projects/${projectId}/release/start`, { method: 'POST', body: JSON.stringify({ version, sourceRef }) }),
  releasePlans: () => request<ReleasePlanCenter>('/api/release-plans'),
  releasePlan: (planId: number) => request<ReleasePlan>(`/api/release-plans/${planId}`),
  health: () => request<any>('/api/health')
};
