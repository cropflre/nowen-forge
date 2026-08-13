import { db, getReleaseManifest, type ReleaseManifestRecord } from './db.js';

export type DockerPlatformEvidence = {
  os: string;
  architecture: string;
  variant: string | null;
  digest: string;
  mediaType: string | null;
};

export type DockerManifestProbe = {
  image: string;
  tag: string;
  digest: string;
  mediaType: string | null;
  platforms: DockerPlatformEvidence[];
};

export type ManifestDockerEvidence = DockerManifestProbe & {
  observedAt: string;
};

export type ManifestDockerEvidenceState = {
  supported: boolean;
  current: ManifestDockerEvidence | null;
  observations: ManifestDockerEvidence[];
  digestChanged: boolean;
  expectedPlatforms: string[];
  missingPlatforms: string[];
};

const dockerImages: Record<string, string> = {
  'nowen-note': 'cropflre/nowen-note',
  'nowen-reader': 'cropflre/nowen-reader',
  NOWEN: 'cropflre/nowen'
};

const EXPECTED_PLATFORMS = ['linux/amd64', 'linux/arm64'];
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

db.exec(`
  CREATE TABLE IF NOT EXISTS manifest_docker_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
    image TEXT NOT NULL,
    tag TEXT NOT NULL,
    digest TEXT NOT NULL,
    media_type TEXT,
    platforms_json TEXT NOT NULL DEFAULT '[]',
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(manifest_id, image, tag, digest)
  );

  CREATE INDEX IF NOT EXISTS idx_manifest_docker_evidence_manifest
    ON manifest_docker_evidence(manifest_id, id);
`);

function normalizeVersion(value: string) {
  return value.trim().replace(/^v(?=\d)/i, '');
}

function candidateTags(version: string) {
  const raw = version.trim();
  const normalized = normalizeVersion(raw);
  return Array.from(new Set([raw, raw.startsWith('v') ? normalized : `v${normalized}`].filter(Boolean)));
}

function platformKey(platform: DockerPlatformEvidence) {
  return `${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ''}`;
}

async function registryToken(image: string) {
  const response = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${image}:pull`)}`, {
    signal: AbortSignal.timeout(6500),
    headers: { 'User-Agent': 'Nowen-Forge/0.9' }
  });
  if (!response.ok) throw new Error(`Docker registry token HTTP ${response.status}`);
  const body = await response.json() as { token?: string; access_token?: string };
  const token = body.token || body.access_token;
  if (!token) throw new Error('Docker registry token missing');
  return token;
}

export async function probeDockerManifest(image: string, tag: string): Promise<DockerManifestProbe | null> {
  const token = await registryToken(image);
  const response = await fetch(`https://registry-1.docker.io/v2/${image}/manifests/${encodeURIComponent(tag)}`, {
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: MANIFEST_ACCEPT,
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Nowen-Forge/0.9'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Docker registry manifest HTTP ${response.status}`);

  const body = await response.json() as any;
  const digest = response.headers.get('docker-content-digest');
  if (!digest) throw new Error('Docker registry did not return Docker-Content-Digest');
  const manifests = Array.isArray(body.manifests) ? body.manifests : [];
  const platforms: DockerPlatformEvidence[] = manifests
    .filter((entry: any) => entry?.digest && entry?.platform?.os && entry?.platform?.architecture)
    .map((entry: any) => ({
      os: String(entry.platform.os),
      architecture: String(entry.platform.architecture),
      variant: entry.platform.variant ? String(entry.platform.variant) : null,
      digest: String(entry.digest),
      mediaType: entry.mediaType ? String(entry.mediaType) : null
    }));

  return {
    image,
    tag,
    digest,
    mediaType: body.mediaType || response.headers.get('content-type') || null,
    platforms
  };
}

export async function probeDockerVersion(image: string, version: string): Promise<DockerManifestProbe | null> {
  for (const tag of candidateTags(version)) {
    const probe = await probeDockerManifest(image, tag);
    if (probe) return probe;
  }
  return null;
}

export function getManifestDockerEvidence(manifestId: number): ManifestDockerEvidenceState {
  const manifest = getReleaseManifest(manifestId);
  const image = manifest ? dockerImages[manifest.project.slug] : undefined;
  if (!manifest || !image) {
    return { supported: false, current: null, observations: [], digestChanged: false, expectedPlatforms: EXPECTED_PLATFORMS, missingPlatforms: [] };
  }

  const observations = (db.prepare(`
    SELECT * FROM manifest_docker_evidence
    WHERE manifest_id = ?
    ORDER BY id ASC
  `).all(manifestId) as any[]).map((row) => ({
    image: row.image,
    tag: row.tag,
    digest: row.digest,
    mediaType: row.media_type || null,
    platforms: JSON.parse(row.platforms_json || '[]'),
    observedAt: row.observed_at
  })) as ManifestDockerEvidence[];
  const current = observations.at(-1) || null;
  const platformKeys = new Set((current?.platforms || []).map(platformKey));
  const missingPlatforms = EXPECTED_PLATFORMS.filter((expected) => !platformKeys.has(expected));

  return {
    supported: true,
    current,
    observations,
    digestChanged: new Set(observations.map((item) => item.digest)).size > 1,
    expectedPlatforms: EXPECTED_PLATFORMS,
    missingPlatforms
  };
}

export function withDockerEvidence<T extends ReleaseManifestRecord>(manifest: T): T & { dockerEvidence: ManifestDockerEvidenceState } {
  return { ...manifest, dockerEvidence: getManifestDockerEvidence(manifest.id) };
}

export async function syncManifestDockerEvidence(manifestId: number) {
  const manifest = getReleaseManifest(manifestId);
  if (!manifest) throw Object.assign(new Error('Manifest not found'), { statusCode: 404 });
  const image = dockerImages[manifest.project.slug];
  if (!image) return { manifest: withDockerEvidence(manifest), supported: false, found: false, inserted: false };

  const probe = await probeDockerVersion(image, manifest.version);
  if (!probe) return { manifest: withDockerEvidence(manifest), supported: true, found: false, inserted: false };

  const result = db.prepare(`
    INSERT OR IGNORE INTO manifest_docker_evidence (
      manifest_id, image, tag, digest, media_type, platforms_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    manifest.id,
    probe.image,
    probe.tag,
    probe.digest,
    probe.mediaType,
    JSON.stringify(probe.platforms)
  );

  return {
    manifest: withDockerEvidence(getReleaseManifest(manifest.id)!),
    supported: true,
    found: true,
    inserted: result.changes > 0,
    probe
  };
}
