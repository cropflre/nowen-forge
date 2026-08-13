import type { Project } from './db.js';
import { listGithubReleases, listRunsForWorkflow, listWorkflows } from './github.js';

type ChannelStatus = 'success' | 'running' | 'failed' | 'warning' | 'empty' | 'unavailable';

type Channel = {
  kind: 'github' | 'dockerhub' | 'gitee' | 'testflight';
  label: string;
  status: ChannelStatus;
  summary: string;
  detail?: string;
  version?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  tags?: string[];
};

type ProjectReleaseConfig = {
  dockerImage?: string;
  workflowChannels?: Array<{
    kind: 'gitee' | 'testflight';
    label: string;
    workflowPath: string;
    detail: string;
  }>;
};

const configs: Record<string, ProjectReleaseConfig> = {
  'nowen-note': {
    dockerImage: 'cropflre/nowen-note',
    workflowChannels: [
      { kind: 'gitee', label: 'Gitee Release', workflowPath: 'sync-gitee-release.yml', detail: '状态来自 GitHub → Gitee 同步流水线' },
      { kind: 'testflight', label: 'TestFlight', workflowPath: 'ios-release.yml', detail: '状态来自 iOS Build & TestFlight 流水线' }
    ]
  },
  'nowen-reader': { dockerImage: 'cropflre/nowen-reader' },
  NOWEN: { dockerImage: 'cropflre/nowen' }
};

export async function buildReleaseCenter(projects: Project[]) {
  const projectResults = await Promise.all(projects.map(buildProjectRelease));
  const recentReleases = projectResults
    .flatMap((item) => item.releases.map((release) => ({ ...release, projectId: item.project.id, projectSlug: item.project.slug, projectName: item.project.displayName })))
    .sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime())
    .slice(0, 30);
  const channels = projectResults.flatMap((project) => project.channels);

  return {
    projects: projectResults,
    recentReleases,
    stats: {
      projectCount: projects.length,
      channelCount: channels.length,
      publishedProjectCount: projectResults.filter((item) => item.releases.some((release) => !release.draft)).length,
      attentionCount: channels.filter((channel) => ['failed', 'warning', 'unavailable'].includes(channel.status)).length
    }
  };
}

async function buildProjectRelease(project: Project) {
  const config = configs[project.slug] || {};
  const releasesPromise = listGithubReleases(project, 8)
    .then((releases) => ({ releases, error: null as string | null }))
    .catch((error) => ({ releases: [], error: error instanceof Error ? error.message : 'GitHub Release 状态读取失败' }));
  const workflowChannelsPromise = Promise.all((config.workflowChannels || []).map((channel) => buildWorkflowChannel(project, channel)));
  const dockerPromise = config.dockerImage ? buildDockerHubChannel(config.dockerImage) : Promise.resolve(null);
  const [{ releases, error: releasesError }, workflowChannels, dockerChannel] = await Promise.all([releasesPromise, workflowChannelsPromise, dockerPromise]);

  const latest = releases.at(0) || null;
  const githubChannel: Channel = releasesError
    ? {
        kind: 'github',
        label: 'GitHub Release',
        status: 'unavailable',
        summary: 'Release 状态读取失败',
        detail: releasesError,
        url: `https://github.com/${project.owner}/${project.repo}/releases`
      }
    : latest
      ? {
          kind: 'github',
          label: 'GitHub Release',
          status: latest.draft ? 'warning' : 'success',
          summary: `${latest.tagName}${latest.draft ? ' · Draft' : latest.prerelease ? ' · Pre-release' : ''}`,
          detail: `${latest.assets.length} 个 Release 制品`,
          version: latest.tagName,
          updatedAt: latest.publishedAt || latest.createdAt,
          url: latest.htmlUrl
        }
      : {
          kind: 'github',
          label: 'GitHub Release',
          status: 'empty',
          summary: '暂无 GitHub Release',
          detail: '构建记录仍可在流水线页面查看',
          url: `https://github.com/${project.owner}/${project.repo}/releases`
        };

  return {
    project,
    latestRelease: latest,
    releases,
    channels: [githubChannel, ...(dockerChannel ? [dockerChannel] : []), ...workflowChannels]
  };
}

async function buildWorkflowChannel(project: Project, config: NonNullable<ProjectReleaseConfig['workflowChannels']>[number]): Promise<Channel> {
  try {
    const workflows = await listWorkflows(project);
    const workflow = workflows.find((item) => item.path.endsWith(`/${config.workflowPath}`) || item.path.endsWith(config.workflowPath));
    if (!workflow) {
      return { kind: config.kind, label: config.label, status: 'unavailable', summary: '未找到对应流水线', detail: config.detail };
    }
    const runs = await listRunsForWorkflow(project, workflow.id, 1);
    const run = runs.at(0);
    if (!run) return { kind: config.kind, label: config.label, status: 'empty', summary: '尚未执行', detail: config.detail };
    return {
      kind: config.kind,
      label: config.label,
      status: run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'success' : run.conclusion === 'cancelled' ? 'warning' : 'failed',
      summary: run.status !== 'completed' ? `运行中 · #${run.runNumber}` : run.conclusion === 'success' ? `最近任务成功 · #${run.runNumber}` : `最近任务 ${run.conclusion || '失败'} · #${run.runNumber}`,
      detail: config.detail,
      updatedAt: run.updatedAt,
      url: run.htmlUrl
    };
  } catch (error) {
    return { kind: config.kind, label: config.label, status: 'unavailable', summary: '状态读取失败', detail: error instanceof Error ? error.message : config.detail };
  }
}

async function buildDockerHubChannel(image: string): Promise<Channel> {
  try {
    const [namespace, repository] = image.split('/');
    if (!namespace || !repository) return { kind: 'dockerhub', label: 'Docker Hub', status: 'unavailable', summary: '镜像配置无效', detail: image };
    const response = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=8&ordering=last_updated`, {
      signal: AbortSignal.timeout(6500),
      headers: { 'User-Agent': 'Nowen-Forge/0.3' }
    });
    if (!response.ok) {
      return { kind: 'dockerhub', label: 'Docker Hub', status: response.status === 404 ? 'empty' : 'unavailable', summary: response.status === 404 ? '镜像尚未发布' : `Docker Hub HTTP ${response.status}`, detail: image, url: `https://hub.docker.com/r/${image}` };
    }
    const body = await response.json() as { results?: Array<{ name: string; last_updated?: string }> };
    const tags = body.results || [];
    const latest = tags.at(0);
    if (!latest) return { kind: 'dockerhub', label: 'Docker Hub', status: 'empty', summary: '暂无镜像 Tag', detail: image, url: `https://hub.docker.com/r/${image}` };
    return {
      kind: 'dockerhub',
      label: 'Docker Hub',
      status: 'success',
      summary: `${image}:${latest.name}`,
      detail: `最近 ${Math.min(tags.length, 5)} 个 Tag 已同步`,
      version: latest.name,
      updatedAt: latest.last_updated || null,
      url: `https://hub.docker.com/r/${image}`,
      tags: tags.slice(0, 5).map((tag) => tag.name)
    };
  } catch (error) {
    return { kind: 'dockerhub', label: 'Docker Hub', status: 'unavailable', summary: 'Docker Hub 暂时不可达', detail: error instanceof Error ? error.message : image, url: `https://hub.docker.com/r/${image}` };
  }
}
