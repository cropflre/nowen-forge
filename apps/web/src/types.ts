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

export type Dashboard = {
  githubConfigured: boolean;
  projects: Array<Project & { latestRun: Run | null; error: string | null }>;
  latestRuns: Run[];
  stats: { projectCount: number; recentRunCount: number; runningCount: number; successRate: number | null };
};
