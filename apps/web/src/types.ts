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

export type Workflow = {
  id: number;
  name: string;
  path: string;
  state: string;
  recommended: boolean;
};

export type WorkflowInput = {
  name: string;
  description: string;
  required: boolean;
  defaultValue: string;
  type: 'string' | 'choice' | 'boolean' | 'number' | 'environment';
  options: string[];
};

export type WorkflowSchema = {
  workflowId: number;
  name: string;
  path: string;
  dispatchable: boolean;
  sourceSha: string;
  inputs: WorkflowInput[];
  warnings: string[];
};

export type Run = {
  id: number;
  name: string;
  displayTitle: string;
  event: string;
  status: string;
  conclusion: string | null;
  workflowId: number;
  runNumber: number;
  headBranch: string | null;
  headSha: string;
  actor: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  projectId?: number;
  projectSlug?: string;
  projectName?: string;
};

export type GithubRelease = {
  id: number;
  tagName: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  htmlUrl: string;
  assets: Array<{
    id: number;
    name: string;
    size: number;
    digest?: string | null;
    contentType?: string | null;
    downloadCount: number;
    browserDownloadUrl: string;
  }>;
  projectId?: number;
  projectSlug?: string;
  projectName?: string;
};

export type ReleaseChannel = {
  kind: 'github' | 'dockerhub' | 'gitee' | 'testflight';
  label: string;
  status: 'success' | 'running' | 'failed' | 'warning' | 'empty' | 'unavailable';
  summary: string;
  detail?: string;
  version?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  tags?: string[];
  verification?: 'platform' | 'workflow' | 'unconfigured';
};

export type ReleaseCenter = {
  projects: Array<{
    project: Project;
    latestRelease: GithubRelease | null;
    releases: GithubRelease[];
    channels: ReleaseChannel[];
  }>;
  recentReleases: GithubRelease[];
  stats: {
    projectCount: number;
    channelCount: number;
    publishedProjectCount: number;
    platformVerifiedCount: number;
    unverifiedCount: number;
    attentionCount: number;
  };
};

export type ManifestArtifact = {
  githubArtifactId: number;
  name: string;
  sizeInBytes: number;
  digest: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

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

export type ManifestChannel = {
  kind: string;
  label: string;
  status: string;
  summary: string;
  version?: string | null;
  url?: string | null;
  matchesVersion: boolean | null;
};

export type ReleaseManifest = {
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
  channels: ManifestChannel[];
  artifacts: ManifestArtifact[];
  releaseEvidence: ManifestReleaseEvidence | null;
  createdAt: string;
};

export type ManifestCenter = {
  manifests: ReleaseManifest[];
  stats: {
    manifestCount: number;
    artifactCount: number;
    digestedArtifactCount: number;
    releaseAssetCount: number;
    digestedReleaseAssetCount: number;
    releaseBoundManifestCount: number;
    exactCommitMatchCount: number;
    totalSizeBytes: number;
    totalReleaseAssetSizeBytes: number;
    failedRunCount: number;
  };
};

export type ReleasePlanStatus = 'PREPARING' | 'WAITING_RUNS' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export type ReleasePlanRun = {
  id: number;
  workflowId: string;
  workflowPath: string;
  workflowName: string;
  role: string;
  required: boolean;
  dispatchInputs: Record<string, string>;
  dispatchState: 'pending' | 'auto' | 'manual' | 'fallback' | 'failed';
  dispatchError: string | null;
  runId: number | null;
  runNumber: number | null;
  status: string | null;
  conclusion: string | null;
  runUrl: string | null;
  manifestId: number | null;
  updatedAt: string;
};

export type ReleasePlan = {
  id: number;
  project: Project;
  version: string;
  sourceRef: string;
  sourceSha: string;
  sourceUrl: string;
  tagName: string;
  strategy: 'tag-auto-with-dispatch-fallback' | 'tag-dispatch';
  status: ReleasePlanStatus;
  tagCreated: boolean;
  tagReused: boolean;
  warnings: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  runs: ReleasePlanRun[];
};

export type ReleaseRecoveryAttempt = {
  id: number;
  planId: number;
  kind: 'workflow' | 'gitee' | 'testflight' | 'dockerhub';
  target: string;
  action: string;
  runRowId: number | null;
  workflowId: string | null;
  workflowPath: string | null;
  sourceRunId: number | null;
  runId: number | null;
  status: 'requested' | 'running' | 'waiting_platform' | 'success' | 'failed';
  detail: string | null;
  requestedAt: string;
  updatedAt: string;
};

export type ReleaseRecoveryChannel = ReleaseChannel & {
  retryable: boolean;
  retryLabel: string | null;
  recheckOnly: boolean;
};

export type ReleaseRecoveryState = {
  plan: ReleasePlan;
  channels: ReleaseRecoveryChannel[];
  recoveries: ReleaseRecoveryAttempt[];
};

export type ReleasePreflight = {
  project: Project;
  version: string;
  tagName: string;
  sourceRef: string;
  sourceSha: string;
  sourceUrl: string;
  strategy: 'tag-auto-with-dispatch-fallback' | 'tag-dispatch';
  tag: { exists: boolean; sha: string | null; matchesSource: boolean | null };
  workflows: Array<{
    workflowId: number | null;
    workflowPath: string;
    workflowName: string;
    role: string;
    required: boolean;
    dispatchable: boolean;
    inputs: Record<string, string>;
  }>;
  warnings: string[];
  blockingReasons: string[];
  existingPlan: { id: number; status: ReleasePlanStatus } | null;
  canStart: boolean;
};

export type ReleasePlanCenter = {
  plans: ReleasePlan[];
  stats: { total: number; active: number; succeeded: number; attention: number };
};

export type Dashboard = {
  githubConfigured: boolean;
  projects: Array<Project & { latestRun: Run | null; error: string | null }>;
  latestRuns: Run[];
  stats: { projectCount: number; recentRunCount: number; runningCount: number; successRate: number | null };
};
