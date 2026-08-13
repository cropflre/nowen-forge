import { sign } from 'node:crypto';

export type PlatformChannelStatus = 'success' | 'running' | 'failed' | 'warning' | 'empty' | 'unavailable';

export type PlatformChannel = {
  kind: 'gitee' | 'testflight';
  label: string;
  status: PlatformChannelStatus;
  summary: string;
  detail?: string;
  version?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  tags?: string[];
  verification: 'platform' | 'unconfigured';
};

type GithubReleaseLike = {
  tagName: string;
  assets: Array<{ name: string; size: number }>;
};

const giteeToken = process.env.GITEE_TOKEN?.trim();
const giteeOwner = process.env.GITEE_OWNER?.trim();
const giteeRepo = process.env.GITEE_REPO?.trim();
export const giteePlatformConfigured = Boolean(giteeToken && giteeOwner && giteeRepo);

const appStoreIssuerId = process.env.APPSTORE_ISSUER_ID?.trim();
const appStoreKeyId = process.env.APPSTORE_API_KEY_ID?.trim();
const appStorePrivateKey = process.env.APPSTORE_API_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
const appStoreBundleId = process.env.APPSTORE_BUNDLE_ID?.trim() || 'com.nowen.note';
export const appStorePlatformConfigured = Boolean(appStoreIssuerId && appStoreKeyId && appStorePrivateKey);

const GITEE_MAX_BYTES = 95 * 1024 * 1024;

export async function buildGiteePlatformChannel(release: GithubReleaseLike | null): Promise<PlatformChannel> {
  const baseUrl = giteeOwner && giteeRepo ? `https://gitee.com/${giteeOwner}/${giteeRepo}/releases` : 'https://gitee.com';
  if (!release) {
    return { kind: 'gitee', label: 'Gitee Release', status: 'empty', summary: '暂无可验证版本', detail: 'GitHub 尚无对应 Release', url: baseUrl, verification: giteePlatformConfigured ? 'platform' : 'unconfigured' };
  }
  if (!giteePlatformConfigured) {
    return {
      kind: 'gitee', label: 'Gitee Release', status: 'warning', summary: `${release.tagName} · 平台未验证`,
      detail: 'Forge 未配置 GITEE_TOKEN / GITEE_OWNER / GITEE_REPO；不会把同步 Workflow 成功当成 Gitee 已发布。',
      version: release.tagName, url: baseUrl, verification: 'unconfigured'
    };
  }

  try {
    const releaseResponse = await giteeFetch(`/repos/${encodeURIComponent(giteeOwner!)}/${encodeURIComponent(giteeRepo!)}/releases/tags/${encodeURIComponent(release.tagName)}`);
    if (releaseResponse.status === 404) {
      return { kind: 'gitee', label: 'Gitee Release', status: 'empty', summary: `${release.tagName} · Gitee 未找到 Release`, detail: 'GitHub Release 已存在，但 Gitee 平台尚未出现同 Tag Release。', version: release.tagName, url: baseUrl, verification: 'platform' };
    }
    if (!releaseResponse.ok) throw new Error(`Gitee HTTP ${releaseResponse.status}`);
    const giteeRelease = await releaseResponse.json() as { id: number; tag_name?: string; created_at?: string; name?: string };

    const attachmentsResponse = await giteeFetch(`/repos/${encodeURIComponent(giteeOwner!)}/${encodeURIComponent(giteeRepo!)}/releases/${giteeRelease.id}/attach_files`);
    if (!attachmentsResponse.ok) throw new Error(`Gitee attachments HTTP ${attachmentsResponse.status}`);
    const attachments = await attachmentsResponse.json() as Array<{ id?: number; name?: string; size?: number; browser_download_url?: string }>;
    const actualNames = new Set(attachments.map((item) => item.name).filter(Boolean) as string[]);
    const expected = release.assets.filter((asset) => isGiteeEligibleAsset(asset.name, asset.size)).map((asset) => asset.name);
    const missing = expected.filter((name) => !actualNames.has(name));
    const matched = expected.length - missing.length;
    const status: PlatformChannelStatus = missing.length ? 'warning' : 'success';

    return {
      kind: 'gitee', label: 'Gitee Release', status,
      summary: `${release.tagName} · ${matched}/${expected.length} 个应同步文件已确认`,
      detail: missing.length ? `Gitee 缺少：${missing.slice(0, 4).join('、')}${missing.length > 4 ? ` 等 ${missing.length} 个` : ''}` : `Gitee API 已确认同版本 Release 与全部 ${expected.length} 个小文件附件。`,
      version: giteeRelease.tag_name || release.tagName,
      updatedAt: giteeRelease.created_at || null,
      url: `${baseUrl}/tag/${encodeURIComponent(release.tagName)}`,
      tags: attachments.slice(0, 6).map((item) => item.name || `asset-${item.id}`),
      verification: 'platform'
    };
  } catch (error) {
    return { kind: 'gitee', label: 'Gitee Release', status: 'unavailable', summary: `${release.tagName} · Gitee API 不可用`, detail: error instanceof Error ? error.message : 'Gitee request failed', version: release.tagName, url: baseUrl, verification: 'platform' };
  }
}

export async function buildTestFlightPlatformChannel(release: GithubReleaseLike | null): Promise<PlatformChannel> {
  const url = 'https://appstoreconnect.apple.com';
  if (!release) {
    return { kind: 'testflight', label: 'TestFlight', status: 'empty', summary: '暂无可验证版本', detail: 'GitHub 尚无对应 Release', url, verification: appStorePlatformConfigured ? 'platform' : 'unconfigured' };
  }
  const version = iosVersionFromTag(release.tagName);
  if (!appStorePlatformConfigured) {
    return {
      kind: 'testflight', label: 'TestFlight', status: 'warning', summary: `${version} · 平台未验证`,
      detail: 'Forge 未配置 APPSTORE_ISSUER_ID / APPSTORE_API_KEY_ID / APPSTORE_API_PRIVATE_KEY；不会把 iOS Workflow 成功当成 TestFlight 已处理完成。',
      version, url, verification: 'unconfigured'
    };
  }

  try {
    const token = createAppStoreToken();
    const apps = await appStoreGet('/v1/apps', token, {
      'filter[bundleId]': appStoreBundleId,
      'fields[apps]': 'name,bundleId',
      limit: '1'
    }) as { data?: Array<{ id: string; attributes?: { name?: string; bundleId?: string } }> };
    const app = apps.data?.[0];
    if (!app) {
      return { kind: 'testflight', label: 'TestFlight', status: 'empty', summary: `${version} · 未找到 App`, detail: `App Store Connect 未找到 Bundle ID ${appStoreBundleId}`, version, url, verification: 'platform' };
    }

    const builds = await appStoreGet('/v1/builds', token, {
      'filter[app]': app.id,
      'filter[preReleaseVersion.version]': version,
      'filter[preReleaseVersion.platform]': 'IOS',
      'fields[builds]': 'version,uploadedDate,expirationDate,expired,processingState,buildAudienceType',
      'fields[buildBetaDetails]': 'internalBuildState,externalBuildState',
      include: 'buildBetaDetail',
      sort: '-uploadedDate',
      limit: '10'
    }) as {
      data?: Array<{ id: string; attributes?: { version?: string; uploadedDate?: string; expirationDate?: string; expired?: boolean; processingState?: string; buildAudienceType?: string }; relationships?: { buildBetaDetail?: { data?: { id: string } | null } } }>;
      included?: Array<{ type: string; id: string; attributes?: { internalBuildState?: string; externalBuildState?: string } }>;
    };
    const build = builds.data?.[0];
    if (!build) {
      return { kind: 'testflight', label: 'TestFlight', status: 'empty', summary: `${version} · 平台尚无 Build`, detail: `App Store Connect 已确认 App ${app.attributes?.name || appStoreBundleId}，但 TestFlight 尚无 ${version} 的 iOS Build。`, version, url, verification: 'platform' };
    }

    const processing = build.attributes?.processingState || 'UNKNOWN';
    const betaId = build.relationships?.buildBetaDetail?.data?.id;
    const beta = betaId ? builds.included?.find((item) => item.type === 'buildBetaDetails' && item.id === betaId)?.attributes : undefined;
    const status: PlatformChannelStatus = processing === 'VALID' ? 'success' : processing === 'PROCESSING' ? 'running' : ['FAILED', 'INVALID'].includes(processing) ? 'failed' : 'warning';
    const betaStates = [beta?.internalBuildState, beta?.externalBuildState].filter(Boolean) as string[];
    return {
      kind: 'testflight', label: 'TestFlight', status,
      summary: `${version} · Build ${build.attributes?.version || '—'} · ${processing}`,
      detail: betaStates.length ? `App Store Connect 平台已确认；Beta 状态：${betaStates.join(' / ')}` : 'App Store Connect 平台已确认该版本 Build。',
      version,
      updatedAt: build.attributes?.uploadedDate || null,
      url,
      tags: [`Build ${build.attributes?.version || '—'}`, processing, ...betaStates].slice(0, 5),
      verification: 'platform'
    };
  } catch (error) {
    return { kind: 'testflight', label: 'TestFlight', status: 'unavailable', summary: `${version} · App Store Connect API 不可用`, detail: error instanceof Error ? error.message : 'App Store Connect request failed', version, url, verification: 'platform' };
  }
}

function isGiteeEligibleAsset(name: string, size: number) {
  if (size > GITEE_MAX_BYTES) return false;
  if (/\.blockmap$/i.test(name) || /(^|\/)latest.*\.yml$/i.test(name) || /\.yml$/i.test(name)) return false;
  return /\.(exe|apk|zip|deb)$/i.test(name);
}

async function giteeFetch(path: string) {
  const url = new URL(`https://gitee.com/api/v5${path}`);
  url.searchParams.set('access_token', giteeToken!);
  return fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'Nowen-Forge/0.7' } });
}

function iosVersionFromTag(tag: string) {
  const value = tag.trim().replace(/^v/i, '').replace(/-ios$/i, '');
  return value.split('-')[0] || value;
}

function createAppStoreToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: appStoreKeyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: appStoreIssuerId, iat: now, exp: now + 300, aud: 'appstoreconnect-v1' }));
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: appStorePrivateKey!, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function appStoreGet(path: string, token: string, params: Record<string, string>) {
  const url = new URL(`https://api.appstoreconnect.apple.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Nowen-Forge/0.7' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const first = (body as any)?.errors?.[0];
    throw new Error(`App Store Connect HTTP ${response.status}${first?.detail ? `: ${first.detail}` : ''}`);
  }
  return body;
}

function base64url(input: string) {
  return Buffer.from(input).toString('base64url');
}
