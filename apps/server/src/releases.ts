import type { Project } from './db.js';
import { listGithubReleases } from './github.js';
import { buildGiteePlatformChannel, buildTestFlightPlatformChannel, type PlatformChannel } from './platforms.js';

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
  verification?: 'platform' | 'workflow' | 'unconfigured';
};

type ProjectReleaseConfig = {
  dockerImage?: string;
  gitee?: boolean;
  testflight?: boolean;
};

const configs: Record<string, ProjectReleaseConfig> = {
  'nowen-note': { dockerImage: 'cropflre/nowen-note', gitee: true, testflight: true },
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
      platformVerifiedCount: channels.filter((channel) => channel.verification === 'platform' && channel.status === 'success').length,
      unverifiedCount: channels.filter((channel) => channel.verification === 'unconfigured').length,
      attentionCount: channels.filter((channel) => ['failed', 'warning', 'unavailable'].includes(channel.status)).length
    }
  };
}

async function buildProjectRelease(project: Project) {
  const config = configs[project.slug] || {};
  const releasesResult = await listGithubReleases(project, 8)
    .then((releases) => ({ releases, error: null as string | null }))
    .catch((error) => ({ releases: [], error: error instanceof Error ? error.message : 'GitHub Release 状态读取失败' }));
  const latest = releasesResult.releases.at(0) || null;

  const [dockerChannel, giteeChannel, testflightChannel] = await Promise.all([
    config.dockerImage ? buildDockerHubChannel(config.dockerImage) : Promise.resolve(null),
    config.gitee ? buildGiteePlatformChannel(latest) : Promise.resolve(null),
    config.testflight ? buildTestFlightPlatformChannel(latest) : Promise.resolve(null)
  ]);

  const githubChannel: Channel = releasesResult.error
    ? {
        kind: 'github', label: 'GitHub Release', status: 'unavailable', summary: 'Release 状态读取失败', detail: releasesResult.error,
        url: `https://github.com/${project.owner}/${project.repo}/releases`, verification: 'platform'
      }
    : latest
      ? {
          kind: 'github', label: 'GitHub Release', status: latest.draft ? 'warning' : 'success',
          summary: `${latest.tagName}${latest.draft ? ' · Draft' : latest.prerelease ? ' · Pre-release' : ''}`,
          detail: `${latest.assets.length} 个 Release 制品`, version: latest.tagName,
          updatedAt: latest.publishedAt || latest.createdAt, url: latest.htmlUrl, verification: 'platform'
        }
      : {
          kind: 'github', label: 'GitHub Release', status: 'empty', summary: '暂无 GitHub Release',
          detail: '构建记录仍可在流水线页面查看', url: `https://github.com/${project.owner}/${project.repo}/releases`, verification: 'platform'
        };

  const platformChannels = [giteeChannel, testflightChannel].filter(Boolean) as PlatformChannel[];
  return {
    project,
    latestRelease: latest,
    releases: releasesResult.releases,
    channels: [githubChannel, ...(dockerChannel ? [dockerChannel] : []), ...platformChannels] as Channel[]
  };
}

async function buildDockerHubChannel(image: string): Promise<Channel> {
  try {
    const [namespace, repository] = image.split('/');
    if (!namespace || !repository) return { kind: 'dockerhub', label: 'Docker Hub', status: 'unavailable', summary: '镜像配置无效', detail: image, verification: 'platform' };
    const response = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=12&ordering=last_updated`, {
      signal: AbortSignal.timeout(6500),
      headers: { 'User-Agent': 'Nowen-Forge/0.7' }
    });
    if (!response.ok) {
      return { kind: 'dockerhub', label: 'Docker Hub', status: response.status === 404 ? 'empty' : 'unavailable', summary: response.status === 404 ? '镜像尚未发布' : `Docker Hub HTTP ${response.status}`, detail: image, url: `https://hub.docker.com/r/${image}`, verification: 'platform' };
    }
    const body = await response.json() as { results?: Array<{ name: string; last_updated?: string }> };
    const tags = body.results || [];
    const latest = tags.at(0);
    if (!latest) return { kind: 'dockerhub', label: 'Docker Hub', status: 'empty', summary: '暂无镜像 Tag', detail: image, url: `https://hub.docker.com/r/${image}`, verification: 'platform' };
    return {
      kind: 'dockerhub', label: 'Docker Hub', status: 'success', summary: `${image}:${latest.name}`,
      detail: `Docker Hub API 已确认最近 ${Math.min(tags.length, 6)} 个 Tag`, version: latest.name,
      updatedAt: latest.last_updated || null, url: `https://hub.docker.com/r/${image}`,
      tags: tags.slice(0, 6).map((tag) => tag.name), verification: 'platform'
    };
  } catch (error) {
    return { kind: 'dockerhub', label: 'Docker Hub', status: 'unavailable', summary: 'Docker Hub 暂时不可达', detail: error instanceof Error ? error.message : image, url: `https://hub.docker.com/r/${image}`, verification: 'platform' };
  }
}
