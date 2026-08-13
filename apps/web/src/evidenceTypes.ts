import type { Project } from './types';

export type EvidenceArtifact = {
  githubArtifactId: number;
  name: string;
  sizeInBytes: number;
  digest: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type EvidenceRunAttemptJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
};

export type EvidenceRunAttempt = {
  runAttempt: number;
  status: string;
  conclusion: string | null;
  jobCount: number;
  failedJobCount: number;
  startedAt: string | null;
  completedAt: string | null;
  observedAt: string;
  jobs: EvidenceRunAttemptJob[];
};

export type DockerPlatformEvidence = {
  os: string;
  architecture: string;
  variant: string | null;
  digest: string;
  mediaType: string | null;
};

export type DockerObservation = {
  image: string;
  tag: string;
  digest: string;
  mediaType: string | null;
  platforms: DockerPlatformEvidence[];
  observedAt: string;
};

export type DockerEvidenceState = {
  supported: boolean;
  current: DockerObservation | null;
  observations: DockerObservation[];
  digestChanged: boolean;
  expectedPlatforms: string[];
  missingPlatforms: string[];
};

export type EvidenceReleaseAsset = {
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

export type EvidenceReleaseBinding = {
  githubReleaseId: number;
  tagName: string;
  releaseUrl: string;
  tagCommitSha: string;
  commitMatches: boolean;
  draft: boolean;
  prerelease: boolean;
  observedAt: string;
  assets: EvidenceReleaseAsset[];
};

export type EvidenceManifest = {
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
  artifacts: EvidenceArtifact[];
  channels: Array<{ kind: string; label: string; status: string; summary: string; matchesVersion: boolean | null; version?: string | null; url?: string | null }>;
  releaseEvidence: EvidenceReleaseBinding | null;
  runAttempts: EvidenceRunAttempt[];
  dockerEvidence: DockerEvidenceState;
  createdAt: string;
};

export type EvidenceManifestCenter = {
  manifests: EvidenceManifest[];
  stats: {
    manifestCount: number;
    artifactCount: number;
    releaseAssetCount: number;
    digestedReleaseAssetCount: number;
    releaseBoundManifestCount: number;
    exactCommitMatchCount: number;
    runAttemptEvidenceCount: number;
    recoveredManifestCount: number;
    dockerEvidenceCount: number;
    dockerPlatformDigestCount: number;
    dockerDigestMutationCount: number;
  };
};
