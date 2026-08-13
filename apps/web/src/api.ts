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
  branches: (id: number) => request<any>(`/api/projects/${id}/branches`),
  runs: (id: number) => request<any>(`/api/projects/${id}/runs?limit=30`),
  run: (projectId: number, runId: number) => request<any>(`/api/projects/${projectId}/runs/${runId}`),
  dispatch: (projectId: number, workflowId: number, ref: string, inputs: Record<string, string>) => request(`/api/projects/${projectId}/workflows/${workflowId}/dispatch`, { method: 'POST', body: JSON.stringify({ ref, inputs }) }),
  rerunFailed: (projectId: number, runId: number) => request(`/api/projects/${projectId}/runs/${runId}/rerun-failed`, { method: 'POST' }),
  cancel: (projectId: number, runId: number) => request(`/api/projects/${projectId}/runs/${runId}/cancel`, { method: 'POST' }),
  health: () => request<any>('/api/health')
};
