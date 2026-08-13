import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Project = {
  id: number;
  slug: string;
  owner: string;
  repo: string;
  displayName: string;
  kind: string;
  description: string;
  workflowHints: string[];
};

export type ManifestArtifactRecord = {
  githubArtifactId: number;
  name: string;
  sizeInBytes: number;
  digest: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type ManifestChannelRecord = {
  kind: string;
  label: string;
  status: string;
  summary: string;
  version?: string | null;
  url?: string | null;
  matchesVersion: boolean | null;
};

export type ReleaseManifestRecord = {
  id: number;
  project: Project;
  version: string;
  versionSource: 'manual' | 'tag' | 'build';
  runId: number;
  runNumber: number;
  workflowId: string;
  workflowName: string;
  ref: string | null;
  commitSha: string;
  runConclusion: string | null;
  runUrl: string;
  artifactCount: number;
  totalSizeBytes: number;
  channels: ManifestChannelRecord[];
  artifacts: ManifestArtifactRecord[];
  createdAt: string;
};

const defaultDataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || defaultDataDir);
mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'nowen-forge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    workflow_hints_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    ref TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    action TEXT,
    repository TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS release_manifests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    version_source TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    run_number INTEGER NOT NULL,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    ref TEXT,
    commit_sha TEXT NOT NULL,
    run_conclusion TEXT,
    run_url TEXT NOT NULL,
    artifact_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    channels_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, run_id, version)
  );

  CREATE TABLE IF NOT EXISTS manifest_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
    github_artifact_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size_in_bytes INTEGER NOT NULL DEFAULT 0,
    digest TEXT,
    created_at_remote TEXT,
    expires_at TEXT,
    UNIQUE(manifest_id, github_artifact_id)
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_release_manifests_created_at ON release_manifests(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_release_manifests_project ON release_manifests(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_manifest_artifacts_manifest ON manifest_artifacts(manifest_id);
`);

const seeds = [
  ['nowen-note', 'cropflre', 'nowen-note', 'Nowen Note', 'desktop', 'Electron desktop / Web / iOS note application', JSON.stringify(['release.yml', 'ios-release.yml'])],
  ['nowen-video', 'cropflre', 'nowen-video', 'Nowen Video', 'desktop', 'Tauri desktop video application and server', JSON.stringify(['release-desktop.yml', 'server-ci.yml'])],
  ['nowen-reader', 'cropflre', 'nowen-reader', 'Nowen Reader', 'service', 'Go reader service and Docker image', JSON.stringify(['build.yml'])],
  ['NOWEN', 'cropflre', 'NOWEN', 'NOWEN', 'docker', 'Nowen portal Docker application', JSON.stringify(['docker-publish.yml'])]
] as const;

const seed = db.prepare(`
  INSERT INTO projects (slug, owner, repo, display_name, kind, description, workflow_hints_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    owner = excluded.owner,
    repo = excluded.repo,
    display_name = excluded.display_name,
    kind = excluded.kind,
    description = excluded.description,
    workflow_hints_json = excluded.workflow_hints_json
`);
const tx = db.transaction(() => seeds.forEach((row) => seed.run(...row)));
tx();

function mapProject(row: any): Project {
  return {
    id: Number(row.id),
    slug: row.slug,
    owner: row.owner,
    repo: row.repo,
    displayName: row.display_name,
    kind: row.kind,
    description: row.description,
    workflowHints: JSON.parse(row.workflow_hints_json || '[]')
  };
}

function getArtifactsForManifest(manifestId: number): ManifestArtifactRecord[] {
  return (db.prepare('SELECT * FROM manifest_artifacts WHERE manifest_id = ? ORDER BY id').all(manifestId) as any[]).map((row) => ({
    githubArtifactId: Number(row.github_artifact_id),
    name: row.name,
    sizeInBytes: Number(row.size_in_bytes || 0),
    digest: row.digest || null,
    createdAt: row.created_at_remote || null,
    expiresAt: row.expires_at || null
  }));
}

function mapManifest(row: any): ReleaseManifestRecord {
  const project: Project = {
    id: Number(row.project_id),
    slug: row.project_slug,
    owner: row.project_owner,
    repo: row.project_repo,
    displayName: row.project_display_name,
    kind: row.project_kind,
    description: row.project_description,
    workflowHints: JSON.parse(row.project_workflow_hints_json || '[]')
  };
  return {
    id: Number(row.manifest_id),
    project,
    version: row.version,
    versionSource: row.version_source,
    runId: Number(row.run_id),
    runNumber: Number(row.run_number),
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    ref: row.ref || null,
    commitSha: row.commit_sha,
    runConclusion: row.run_conclusion || null,
    runUrl: row.run_url,
    artifactCount: Number(row.artifact_count || 0),
    totalSizeBytes: Number(row.total_size_bytes || 0),
    channels: JSON.parse(row.channels_json || '[]'),
    artifacts: getArtifactsForManifest(Number(row.manifest_id)),
    createdAt: row.manifest_created_at
  };
}

const manifestSelect = `
  SELECT
    m.id AS manifest_id,
    m.project_id,
    m.version,
    m.version_source,
    m.run_id,
    m.run_number,
    m.workflow_id,
    m.workflow_name,
    m.ref,
    m.commit_sha,
    m.run_conclusion,
    m.run_url,
    m.artifact_count,
    m.total_size_bytes,
    m.channels_json,
    m.created_at AS manifest_created_at,
    p.slug AS project_slug,
    p.owner AS project_owner,
    p.repo AS project_repo,
    p.display_name AS project_display_name,
    p.kind AS project_kind,
    p.description AS project_description,
    p.workflow_hints_json AS project_workflow_hints_json
  FROM release_manifests m
  JOIN projects p ON p.id = m.project_id
`;

export function listProjects(): Project[] {
  return db.prepare('SELECT * FROM projects WHERE enabled = 1 ORDER BY id').all().map(mapProject);
}

export function getProject(id: number): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND enabled = 1').get(id);
  return row ? mapProject(row) : undefined;
}

export function getProjectByRepository(owner: string, repo: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) AND enabled = 1').get(owner, repo);
  return row ? mapProject(row) : undefined;
}

export function recordDispatch(projectId: number, workflowId: string, workflowName: string, ref: string, inputs: Record<string, string>) {
  db.prepare(`INSERT INTO dispatches (project_id, workflow_id, workflow_name, ref, inputs_json) VALUES (?, ?, ?, ?, ?)`)
    .run(projectId, workflowId, workflowName, ref, JSON.stringify(inputs));
}

export function recordWebhookEvent(deliveryId: string, eventName: string, action: string | null, repository: string | null, projectId: number | null) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO webhook_events (delivery_id, event_name, action, repository, project_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(deliveryId, eventName, action, repository, projectId);
  return result.changes > 0;
}

export function findReleaseManifest(projectId: number, runId: number, version: string): ReleaseManifestRecord | undefined {
  const row = db.prepare(`${manifestSelect} WHERE m.project_id = ? AND m.run_id = ? AND m.version = ?`).get(projectId, runId, version);
  return row ? mapManifest(row) : undefined;
}

export function getReleaseManifest(id: number): ReleaseManifestRecord | undefined {
  const row = db.prepare(`${manifestSelect} WHERE m.id = ?`).get(id);
  return row ? mapManifest(row) : undefined;
}

export function listReleaseManifests(projectId?: number): ReleaseManifestRecord[] {
  const rows = projectId
    ? db.prepare(`${manifestSelect} WHERE m.project_id = ? ORDER BY m.created_at DESC LIMIT 100`).all(projectId)
    : db.prepare(`${manifestSelect} ORDER BY m.created_at DESC LIMIT 100`).all();
  return (rows as any[]).map(mapManifest);
}

export function insertReleaseManifest(input: {
  projectId: number;
  version: string;
  versionSource: 'manual' | 'tag' | 'build';
  runId: number;
  runNumber: number;
  workflowId: string;
  workflowName: string;
  ref: string | null;
  commitSha: string;
  runConclusion: string | null;
  runUrl: string;
  channels: ManifestChannelRecord[];
  artifacts: ManifestArtifactRecord[];
}) {
  const totalSizeBytes = input.artifacts.reduce((sum, artifact) => sum + artifact.sizeInBytes, 0);
  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO release_manifests (
        project_id, version, version_source, run_id, run_number, workflow_id, workflow_name,
        ref, commit_sha, run_conclusion, run_url, artifact_count, total_size_bytes, channels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.projectId,
      input.version,
      input.versionSource,
      input.runId,
      input.runNumber,
      input.workflowId,
      input.workflowName,
      input.ref,
      input.commitSha,
      input.runConclusion,
      input.runUrl,
      input.artifacts.length,
      totalSizeBytes,
      JSON.stringify(input.channels)
    );
    const manifestId = Number(result.lastInsertRowid);
    const insertArtifact = db.prepare(`
      INSERT INTO manifest_artifacts (
        manifest_id, github_artifact_id, name, size_in_bytes, digest, created_at_remote, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const artifact of input.artifacts) {
      insertArtifact.run(
        manifestId,
        artifact.githubArtifactId,
        artifact.name,
        artifact.sizeInBytes,
        artifact.digest,
        artifact.createdAt,
        artifact.expiresAt
      );
    }
    return manifestId;
  });
  return getReleaseManifest(transaction())!;
}
