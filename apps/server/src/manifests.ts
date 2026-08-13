import type { Project, ManifestChannelRecord } from './db.js';
import { findReleaseManifest, insertReleaseManifest, listReleaseManifests } from './db.js';
import { getRunDetails } from './github.js';
import { getManifestReleaseEvidence, syncManifestReleaseEvidence, withReleaseEvidence } from './releaseEvidence.js';
import { syncManifestRunAttemptEvidence } from './runAttemptEvidence.js';
import { syncManifestDockerEvidence } from './dockerEvidence.js';
import { buildReleaseCenter } from './releases.js';

function normalizeVersion(value: string) {
  return value.trim().replace(/^v(?=\d)/i, '').toLowerCase();
}

function inferVersion(ref: string | null, runNumber: number) {
  const value = ref?.trim() || '';
  if (/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    return { version: value, source: 'tag' as const };
  }
  return { version: `build-${runNumber}`, source: 'build' as const };
}

function buildChannelSnapshot(releaseProject: any, version: string): ManifestChannelRecord[] {
  const normalized = normalizeVersion(version);
  const exactRelease = releaseProject.releases.find((release: any) => normalizeVersion(release.tagName) === normalized);

  return releaseProject.channels.map((channel: any) => {
    if (channel.kind === 'github') {
      if (!exactRelease) {
        return {
          kind: channel.kind,
          label: channel.label,
          status: 'empty',
          summary: `未找到 ${version} 对应的 GitHub Release`,
          version: null,
          url: `https://github.com/${releaseProject.project.owner}/${releaseProject.project.repo}/releases`,
          matchesVersion: false
        };
      }
      return {
        kind: channel.kind,
        label: channel.label,
        status: exactRelease.draft ? 'warning' : 'success',
        summary: `${exactRelease.tagName}${exactRelease.draft ? ' · Draft' : exactRelease.prerelease ? ' · Pre-release' : ''}`,
        version: exactRelease.tagName,
        url: exactRelease.htmlUrl,
        matchesVersion: true
      };
    }

    if (channel.kind === 'dockerhub') {
      const tags: string[] = Array.isArray(channel.tags) ? channel.tags : [];
      const matchingTag = tags.find((tag) => normalizeVersion(tag) === normalized);
      return {
        kind: channel.kind,
        label: channel.label,
        status: matchingTag ? 'success' : channel.status,
        summary: matchingTag ? `已找到镜像 Tag ${matchingTag}` : channel.summary,
        version: matchingTag || channel.version || null,
        url: channel.url || null,
        matchesVersion: Boolean(matchingTag)
      };
    }

    return {
      kind: channel.kind,
      label: channel.label,
      status: channel.status,
      summary: channel.summary,
      version: channel.version || null,
      url: channel.url || null,
      matchesVersion: null
    };
  });
}

async function syncSupplementalEvidence(manifestId: number) {
  await Promise.allSettled([
    syncManifestRunAttemptEvidence(manifestId),
    syncManifestDockerEvidence(manifestId)
  ]);
}

export async function createManifestFromRun(project: Project, runId: number, requestedVersion?: string) {
  const details = await getRunDetails(project, runId);
  if (details.run.status !== 'completed') {
    throw Object.assign(new Error('Workflow run must be completed before creating a manifest'), { statusCode: 409 });
  }

  const manualVersion = requestedVersion?.trim();
  const inferred = inferVersion(details.run.headBranch, details.run.runNumber);
  const version = manualVersion || inferred.version;
  const versionSource = manualVersion ? 'manual' as const : inferred.source;
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,99}$/.test(version)) {
    throw Object.assign(new Error('Version may only contain letters, numbers, dot, underscore, plus and hyphen'), { statusCode: 400 });
  }

  const existing = findReleaseManifest(project.id, runId, version);
  if (existing) {
    await syncSupplementalEvidence(existing.id);
    try {
      const synced = await syncManifestReleaseEvidence(existing.id);
      return { manifest: synced.manifest, existed: true };
    } catch {
      return { manifest: withReleaseEvidence(existing), existed: true };
    }
  }

  const releaseCenter = await buildReleaseCenter([project]);
  const releaseProject = releaseCenter.projects[0];
  const channels = releaseProject ? buildChannelSnapshot(releaseProject, version) : [];
  const artifacts = details.artifacts.map((artifact: any) => ({
    githubArtifactId: artifact.id,
    name: artifact.name,
    sizeInBytes: artifact.sizeInBytes,
    digest: artifact.digest || null,
    createdAt: artifact.createdAt || null,
    expiresAt: artifact.expiresAt || null
  }));

  const manifest = insertReleaseManifest({
    projectId: project.id,
    version,
    versionSource,
    runId: details.run.id,
    runNumber: details.run.runNumber,
    workflowId: String(details.run.workflowId),
    workflowName: details.run.name,
    ref: details.run.headBranch,
    commitSha: details.run.headSha,
    runConclusion: details.run.conclusion,
    runUrl: details.run.htmlUrl,
    channels,
    artifacts
  });

  await syncSupplementalEvidence(manifest.id);
  try {
    const synced = await syncManifestReleaseEvidence(manifest.id);
    return { manifest: synced.manifest, existed: false };
  } catch {
    return { manifest: withReleaseEvidence(manifest), existed: false };
  }
}

export function buildManifestCenter(projectId?: number) {
  const manifests = listReleaseManifests(projectId).map(withReleaseEvidence);
  const artifacts = manifests.flatMap((manifest) => manifest.artifacts);
  const releaseAssets = manifests.flatMap((manifest) => manifest.releaseEvidence?.assets || []);
  const digested = artifacts.filter((artifact) => Boolean(artifact.digest)).length;
  const digestedReleaseAssets = releaseAssets.filter((asset) => Boolean(asset.digest)).length;
  return {
    manifests,
    stats: {
      manifestCount: manifests.length,
      artifactCount: artifacts.length,
      digestedArtifactCount: digested,
      releaseAssetCount: releaseAssets.length,
      digestedReleaseAssetCount: digestedReleaseAssets,
      releaseBoundManifestCount: manifests.filter((manifest) => Boolean(getManifestReleaseEvidence(manifest.id))).length,
      exactCommitMatchCount: manifests.filter((manifest) => manifest.releaseEvidence?.commitMatches === true).length,
      totalSizeBytes: manifests.reduce((sum, manifest) => sum + manifest.totalSizeBytes, 0),
      totalReleaseAssetSizeBytes: releaseAssets.reduce((sum, asset) => sum + asset.sizeInBytes, 0),
      failedRunCount: manifests.filter((manifest) => manifest.runConclusion && manifest.runConclusion !== 'success').length
    }
  };
}
