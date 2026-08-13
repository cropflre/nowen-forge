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
    attentionCount: number;
  };
};

export type Dashboard = {
  githubConfigured: boolean;
  projects: Array<Project & { latestRun: Run | null; error: string | null }>;
  latestRuns: Run[];
  stats: { projectCount: number; recentRunCount: number; runningCount: number; successRate: number | null };
};
