import { db, getReleaseManifest, type ManifestArtifactRecord, type ReleaseManifestRecord } from './db.js';
import { getTagCommit, octokit } from './github.js';

export type ManifestReleaseAsset = {
  githubAssetId: number;
  name: string;
  sizeInBytes: number;
  digest: string | null;
  contentType: string | null;
  downloadUrl: string;
  createdAt: string | null;
  sourceGithubArtifactId: number | null;
  sourceArtifactName: string | null;
  bindingBasis: 'name' | 'platform' | 'unbound';
};

export type ManifestReleaseEvidence = {
  githubReleaseId: number;
  tagName: string;
  releaseUrl: string;
  tagCommitSha: string;
  commitMatches: boolean;
  draft: boolean;
  prerelease: boolean;
  observedAt: string;
  assets: ManifestReleaseAsset[];
};

export type ManifestWithEvidence = ReleaseManifestRecord & {
  releaseEvidence: ManifestReleaseEvidence | null;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS manifest_release_bindings (
    manifest_id INTEGER PRIMARY KEY REFERENCES release_manifests(id) ON DELETE CASCADE,
    github_release_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    release_url TEXT NOT NULL,
    tag_commit_sha TEXT NOT NULL,
    commit_matches INTEGER NOT NULL,
    draft INTEGER NOT NULL DEFAULT 0,
    prerelease INTEGER NOT NULL DEFAULT 0,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS manifest_release_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
    github_asset_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size_in_bytes INTEGER NOT NULL DEFAULT 0,
    digest TEXT,
    content_type TEXT,
    download_url TEXT NOT NULL,
    created_at_remote TEXT,
    source_github_artifact_id INTEGER,
    source_artifact_name TEXT,
    binding_basis TEXT NOT NULL DEFAULT 'unbound',
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(manifest_id, github_asset_id)
  );

  CREATE INDEX IF NOT EXISTS idx_manifest_release_assets_manifest ON manifest_release_assets(manifest_id, id);
`);

function normalizeVersion(value: string) {
  return value.trim().replace(/^v(?=\d)/i, '').toLowerCase();
}

function releaseAssets(manifestId: number): ManifestReleaseAsset[] {
  return (db.prepare('SELECT * FROM manifest_release_assets WHERE manifest_id = ? ORDER BY id').all(manifestId) as any[]).map((row) => ({
    githubAssetId: Number(row.github_asset_id),
    name: row.name,
    sizeInBytes: Number(row.size_in_bytes || 0),
    digest: row.digest || null,
    contentType: row.content_type || null,
    downloadUrl: row.download_url,
    createdAt: row.created_at_remote || null,
    sourceGithubArtifactId: row.source_github_artifact_id == null ? null : Number(row.source_github_artifact_id),
    sourceArtifactName: row.source_artifact_name || null,
    bindingBasis: (row.binding_basis || 'unbound') as ManifestReleaseAsset['bindingBasis']
  }));
}

export function getManifestReleaseEvidence(manifestId: number): ManifestReleaseEvidence | null {
  const row = db.prepare('SELECT * FROM manifest_release_bindings WHERE manifest_id = ?').get(manifestId) as any;
  if (!row) return null;
  return {
    githubReleaseId: Number(row.github_release_id),
    tagName: row.tag_name,
    releaseUrl: row.release_url,
    tagCommitSha: row.tag_commit_sha,
    commitMatches: Boolean(row.commit_matches),
    draft: Boolean(row.draft),
    prerelease: Boolean(row.prerelease),
    observedAt: row.observed_at,
    assets: releaseAssets(manifestId)
  };
}

export function withReleaseEvidence(manifest: ReleaseManifestRecord): ManifestWithEvidence {
  return { ...manifest, releaseEvidence: getManifestReleaseEvidence(manifest.id) };
}

function inferSourceArtifact(artifacts: ManifestArtifactRecord[], assetName: string) {
  const name = assetName.toLowerCase();
  const exact = artifacts.find((artifact) => {
    const artifactName = artifact.name.toLowerCase();
    return name === artifactName || name.startsWith(`${artifactName}.`) || name.startsWith(`${artifactName}-`);
  });
  if (exact) return { artifact: exact, basis: 'name' as const };

  const platform = (() => {
    if (/\.ipa$/i.test(name)) return 'ios';
    if (/\.dmg$|latest-mac|darwin|macos|\bmac\b/i.test(name)) return 'mac';
    if (/\.deb$|\.appimage$|latest-linux|\blinux\b/i.test(name)) return 'linux';
    if (/\.exe$|\.msi$|latest\.yml$|\bwin(dows)?\b/i.test(name)) return 'win';
    return null;
  })();
  if (!platform) return { artifact: null, basis: 'unbound' as const };

  const candidate = artifacts.find((artifact) => {
    const artifactName = artifact.name.toLowerCase();
    if (platform === 'win') return /win|windows/.test(artifactName);
    if (platform === 'mac') return /mac|darwin/.test(artifactName);
    return artifactName.includes(platform);
  });
  return candidate ? { artifact: candidate, basis: 'platform' as const } : { artifact: null, basis: 'unbound' as const };
}

export async function syncManifestReleaseEvidence(manifestId: number) {
  const manifest = getReleaseManifest(manifestId);
  if (!manifest) throw Object.assign(new Error('Manifest not found'), { statusCode: 404 });

  const { data } = await octokit.rest.repos.listReleases({
    owner: manifest.project.owner,
    repo: manifest.project.repo,
    per_page: 30
  });
  const release = data.find((item) => normalizeVersion(item.tag_name) === normalizeVersion(manifest.version));
  if (!release) {
    return { manifest: withReleaseEvidence(manifest), found: false, insertedAssets: 0 };
  }

  const tag = await getTagCommit(manifest.project, release.tag_name);
  if (!tag.exists || !tag.sha) {
    throw Object.assign(new Error(`Release ${release.tag_name} exists but its tag cannot be resolved`), { statusCode: 409 });
  }
  const commitMatches = tag.sha === manifest.commitSha;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO manifest_release_bindings (
        manifest_id, github_release_id, tag_name, release_url, tag_commit_sha, commit_matches, draft, prerelease
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      manifest.id,
      release.id,
      release.tag_name,
      release.html_url,
      tag.sha,
      commitMatches ? 1 : 0,
      release.draft ? 1 : 0,
      release.prerelease ? 1 : 0
    );

    const insertAsset = db.prepare(`
      INSERT OR IGNORE INTO manifest_release_assets (
        manifest_id, github_asset_id, name, size_in_bytes, digest, content_type, download_url,
        created_at_remote, source_github_artifact_id, source_artifact_name, binding_basis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let insertedAssets = 0;
    for (const raw of release.assets as any[]) {
      const source = inferSourceArtifact(manifest.artifacts, String(raw.name));
      const result = insertAsset.run(
        manifest.id,
        Number(raw.id),
        String(raw.name),
        Number(raw.size || 0),
        typeof raw.digest === 'string' ? raw.digest : null,
        raw.content_type || null,
        String(raw.browser_download_url),
        raw.created_at || null,
        source.artifact?.githubArtifactId ?? null,
        source.artifact?.name ?? null,
        source.basis
      );
      insertedAssets += result.changes;
    }
    return insertedAssets;
  });

  const insertedAssets = transaction();
  return { manifest: withReleaseEvidence(getReleaseManifest(manifest.id)!), found: true, insertedAssets, commitMatches };
}
