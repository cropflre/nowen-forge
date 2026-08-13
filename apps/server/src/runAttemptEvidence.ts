import { db, getReleaseManifest, type ReleaseManifestRecord } from './db.js';
import { octokit } from './github.js';

export type ManifestRunAttemptJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
};

export type ManifestRunAttemptEvidence = {
  runAttempt: number;
  status: string;
  conclusion: string | null;
  jobCount: number;
  failedJobCount: number;
  startedAt: string | null;
  completedAt: string | null;
  observedAt: string;
  jobs: ManifestRunAttemptJob[];
};

export type ManifestWithRunAttempts = ReleaseManifestRecord & {
  runAttempts: ManifestRunAttemptEvidence[];
};

db.exec(`
  CREATE TABLE IF NOT EXISTS manifest_run_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
    run_attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    conclusion TEXT,
    job_count INTEGER NOT NULL DEFAULT 0,
    failed_job_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    jobs_json TEXT NOT NULL DEFAULT '[]',
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(manifest_id, run_attempt)
  );

  CREATE INDEX IF NOT EXISTS idx_manifest_run_attempts_manifest
    ON manifest_run_attempts(manifest_id, run_attempt);
`);

export function getManifestRunAttempts(manifestId: number): ManifestRunAttemptEvidence[] {
  return (db.prepare(`
    SELECT * FROM manifest_run_attempts
    WHERE manifest_id = ?
    ORDER BY run_attempt ASC
  `).all(manifestId) as any[]).map((row) => ({
    runAttempt: Number(row.run_attempt),
    status: row.status,
    conclusion: row.conclusion || null,
    jobCount: Number(row.job_count || 0),
    failedJobCount: Number(row.failed_job_count || 0),
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    observedAt: row.observed_at,
    jobs: JSON.parse(row.jobs_json || '[]')
  }));
}

export function withRunAttemptEvidence<T extends ReleaseManifestRecord>(manifest: T): T & { runAttempts: ManifestRunAttemptEvidence[] } {
  return { ...manifest, runAttempts: getManifestRunAttempts(manifest.id) };
}

function minDate(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (!valid.length) return null;
  return valid.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;
}

function maxDate(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (!valid.length) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

export async function syncManifestRunAttemptEvidence(manifestId: number) {
  const manifest = getReleaseManifest(manifestId);
  if (!manifest) throw Object.assign(new Error('Manifest not found'), { statusCode: 404 });

  const { data: run } = await octokit.rest.actions.getWorkflowRun({
    owner: manifest.project.owner,
    repo: manifest.project.repo,
    run_id: manifest.runId
  });
  const runAttempt = Number(run.run_attempt || 1);

  if (run.status !== 'completed') {
    return { manifest: withRunAttemptEvidence(manifest), inserted: false, reason: 'run-not-completed' as const };
  }

  const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs', {
    owner: manifest.project.owner,
    repo: manifest.project.repo,
    run_id: manifest.runId,
    attempt_number: runAttempt,
    per_page: 100
  });

  const jobs: ManifestRunAttemptJob[] = data.jobs.map((job: any) => ({
    id: Number(job.id),
    name: String(job.name),
    status: String(job.status || 'unknown'),
    conclusion: job.conclusion || null,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    htmlUrl: job.html_url || null
  }));
  const failedJobCount = jobs.filter((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped').length;
  const result = db.prepare(`
    INSERT OR IGNORE INTO manifest_run_attempts (
      manifest_id, run_attempt, status, conclusion, job_count, failed_job_count,
      started_at, completed_at, jobs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    manifest.id,
    runAttempt,
    String(run.status || 'completed'),
    run.conclusion || null,
    jobs.length,
    failedJobCount,
    run.run_started_at || minDate(jobs.map((job) => job.startedAt)),
    run.updated_at || maxDate(jobs.map((job) => job.completedAt)),
    JSON.stringify(jobs)
  );

  return {
    manifest: withRunAttemptEvidence(getReleaseManifest(manifest.id)!),
    inserted: result.changes > 0,
    runAttempt
  };
}
