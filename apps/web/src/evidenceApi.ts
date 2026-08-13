import type { EvidenceManifest, EvidenceManifestCenter } from './evidenceTypes';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const evidenceApi = {
  manifests: (projectId?: number) => request<EvidenceManifestCenter>(`/api/evidence/manifests${projectId ? `?projectId=${projectId}` : ''}`),
  manifest: (manifestId: number) => request<EvidenceManifest>(`/api/evidence/manifests/${manifestId}`),
  sync: (manifestId: number) => request<{ manifest: EvidenceManifest; sources: Record<string, unknown> }>(`/api/evidence/manifests/${manifestId}/sync`, { method: 'POST' }),
  artifactDownloadUrl: (projectId: number, artifactId: number) => `/api/projects/${projectId}/artifacts/${artifactId}/download`,
  capabilities: () => request<{ version: string; runAttemptEvidence: boolean; dockerManifestDigest: boolean; dockerPlatformDigests: boolean; appendOnly: boolean }>('/api/evidence/capabilities')
};
