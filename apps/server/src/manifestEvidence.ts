import type { FastifyBaseLogger } from 'fastify';
import { db, getReleaseManifest, type ReleaseManifestRecord } from './db.js';
import { buildManifestCenter } from './manifests.js';
import { syncManifestDockerEvidence, withDockerEvidence } from './dockerEvidence.js';
import { syncManifestReleaseEvidence, withReleaseEvidence } from './releaseEvidence.js';
import { syncManifestRunAttemptEvidence, withRunAttemptEvidence } from './runAttemptEvidence.js';

const EVIDENCE_WATCH_MS = 15_000;

export function withManifestEvidence<T extends ReleaseManifestRecord>(manifest: T) {
  return withDockerEvidence(withRunAttemptEvidence(withReleaseEvidence(manifest)));
}

export function buildEvidenceManifestCenter(projectId?: number) {
  const base = buildManifestCenter(projectId);
  const manifests = base.manifests.map(withManifestEvidence);
  const runAttempts = manifests.flatMap((manifest) => manifest.runAttempts);
  const dockerObservations = manifests.flatMap((manifest) => manifest.dockerEvidence.observations);
  return {
    ...base,
    manifests,
    stats: {
      ...base.stats,
      runAttemptEvidenceCount: runAttempts.length,
      recoveredManifestCount: manifests.filter((manifest) => manifest.runAttempts.length > 1).length,
      dockerEvidenceCount: manifests.filter((manifest) => Boolean(manifest.dockerEvidence.current)).length,
      dockerPlatformDigestCount: dockerObservations.reduce((sum, item) => sum + item.platforms.length, 0),
      dockerDigestMutationCount: manifests.filter((manifest) => manifest.dockerEvidence.digestChanged).length
    }
  };
}

export async function syncManifestEvidence(manifestId: number) {
  const manifest = getReleaseManifest(manifestId);
  if (!manifest) throw Object.assign(new Error('Manifest not found'), { statusCode: 404 });

  const [attemptResult, releaseResult, dockerResult] = await Promise.allSettled([
    syncManifestRunAttemptEvidence(manifestId),
    syncManifestReleaseEvidence(manifestId),
    syncManifestDockerEvidence(manifestId)
  ]);

  return {
    manifest: withManifestEvidence(getReleaseManifest(manifestId)!),
    sources: {
      runAttempt: summarize(attemptResult),
      githubRelease: summarize(releaseResult),
      docker: summarize(dockerResult)
    }
  };
}

function summarize(result: PromiseSettledResult<any>) {
  if (result.status === 'fulfilled') return { ok: true, result: result.value };
  return { ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

function recentRecoveryManifestIds() {
  return (db.prepare(`
    SELECT DISTINCT m.id AS manifest_id
    FROM release_recovery_attempts ra
    JOIN release_plans rp ON rp.id = ra.plan_id
    JOIN release_manifests m ON m.project_id = rp.project_id AND m.version = rp.version
    WHERE datetime(ra.updated_at) >= datetime('now', '-10 minutes')
    ORDER BY m.id DESC
    LIMIT 20
  `).all() as Array<{ manifest_id: number }>).map((row) => Number(row.manifest_id));
}

export function startManifestEvidenceWatcher(log: FastifyBaseLogger) {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const manifestId of recentRecoveryManifestIds()) {
        try {
          await syncManifestEvidence(manifestId);
        } catch (error) {
          log.warn({ err: error, manifestId }, 'manifest evidence watcher sync failed');
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), EVIDENCE_WATCH_MS);
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
