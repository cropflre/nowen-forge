import type { FastifyInstance } from 'fastify';
import { getReleaseManifest } from './db.js';
import { buildEvidenceManifestCenter, syncManifestEvidence, withManifestEvidence } from './manifestEvidence.js';
import { publishRealtime } from './realtime.js';

export async function registerEvidenceApi(app: FastifyInstance) {
  app.get('/api/evidence/manifests', async (request) => {
    const query = request.query as { projectId?: string };
    const parsed = query.projectId ? Number(query.projectId) : undefined;
    const projectId = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
    return buildEvidenceManifestCenter(projectId);
  });

  app.get('/api/evidence/manifests/:manifestId', async (request, reply) => {
    const { manifestId } = request.params as { manifestId: string };
    const manifest = getReleaseManifest(Number(manifestId));
    if (!manifest) return reply.code(404).send({ message: 'Manifest not found' });
    return withManifestEvidence(manifest);
  });

  app.post('/api/evidence/manifests/:manifestId/sync', async (request, reply) => {
    const { manifestId } = request.params as { manifestId: string };
    const result = await syncManifestEvidence(Number(manifestId));
    const manifest = result.manifest;
    publishRealtime({
      type: 'release',
      projectId: manifest.project.id,
      projectSlug: manifest.project.slug,
      repository: `${manifest.project.owner}/${manifest.project.repo}`,
      source: 'forge',
      action: 'manifest-evidence-synced'
    });
    return reply.send(result);
  });

  app.get('/api/evidence/capabilities', async () => ({
    version: '0.9.0',
    runAttemptEvidence: true,
    dockerManifestDigest: true,
    dockerPlatformDigests: true,
    appendOnly: true
  }));
}
