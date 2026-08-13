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

  CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);
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
    id: row.id,
    slug: row.slug,
    owner: row.owner,
    repo: row.repo,
    displayName: row.display_name,
    kind: row.kind,
    description: row.description,
    workflowHints: JSON.parse(row.workflow_hints_json || '[]')
  };
}

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
