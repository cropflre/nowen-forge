import './env.js';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type GitHubAuthUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
};

type StoredGitHubAuth = {
  accessToken: string;
  tokenType: string;
  scope: string;
  user: GitHubAuthUser;
  createdAt: string;
};

type DeviceSession = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  lastPollAt: number;
};

type WebSession = {
  callbackUrl: string;
  returnTo: string;
  expiresAt: number;
};

const defaultDataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || defaultDataDir);
const authFile = path.join(dataDir, 'github-auth.json');
mkdirSync(dataDir, { recursive: true });

const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || '';
const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || '';
const scopes = process.env.GITHUB_OAUTH_SCOPES?.trim() || 'repo workflow read:user';
const configuredCallbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL?.trim() || '';
const deviceSessions = new Map<string, DeviceSession>();
const webSessions = new Map<string, WebSession>();
const listeners = new Set<() => void>();

let storedAuth = loadStoredAuth();

function loadStoredAuth(): StoredGitHubAuth | null {
  try {
    const parsed = JSON.parse(readFileSync(authFile, 'utf8')) as StoredGitHubAuth;
    if (!parsed?.accessToken || !parsed?.user?.login) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistStoredAuth(auth: StoredGitHubAuth | null) {
  storedAuth = auth;
  try {
    if (!auth) rmSync(authFile, { force: true });
    else writeFileSync(authFile, `${JSON.stringify(auth, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } finally {
    for (const listener of listeners) listener();
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of deviceSessions) if (session.expiresAt <= now) deviceSessions.delete(id);
  for (const [state, session] of webSessions) if (session.expiresAt <= now) webSessions.delete(state);
}

async function githubJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Nowen-Forge',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw Object.assign(new Error(data.error_description || data.message || `GitHub OAuth request failed: HTTP ${response.status}`), {
      statusCode: response.status || 502
    });
  }
  return data as T;
}

async function fetchUser(accessToken: string): Promise<GitHubAuthUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Nowen-Forge'
    }
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok || !data.login) {
    throw Object.assign(new Error(data.message || 'GitHub user profile could not be read'), { statusCode: response.status || 502 });
  }
  return {
    login: String(data.login),
    name: data.name ? String(data.name) : null,
    avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
    htmlUrl: data.html_url ? String(data.html_url) : null
  };
}

async function saveOAuthToken(input: { accessToken: string; tokenType?: string; scope?: string }) {
  const user = await fetchUser(input.accessToken);
  persistStoredAuth({
    accessToken: input.accessToken,
    tokenType: input.tokenType || 'bearer',
    scope: input.scope || '',
    user,
    createdAt: new Date().toISOString()
  });
  return user;
}

function safeReturnTo(value?: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export function getGitHubToken() {
  return storedAuth?.accessToken || process.env.GITHUB_TOKEN?.trim() || undefined;
}

export function onGitHubAuthChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGitHubAuthStatus() {
  const envToken = Boolean(process.env.GITHUB_TOKEN?.trim());
  const loginMode = clientId ? (clientSecret ? 'web' as const : 'device' as const) : null;
  return {
    authenticated: Boolean(getGitHubToken()),
    mode: storedAuth ? 'oauth' as const : envToken ? 'token' as const : 'anonymous' as const,
    loginMode,
    oauthConfigured: Boolean(clientId),
    webOAuthConfigured: Boolean(clientId && clientSecret),
    user: storedAuth?.user || null,
    scope: storedAuth?.scope || null,
    tokenFallbackConfigured: envToken
  };
}

export function getOAuthCallbackUrl(origin: string) {
  return configuredCallbackUrl || `${origin.replace(/\/$/, '')}/api/auth/github/callback`;
}

export function beginWebLogin(callbackUrl: string, returnTo?: string) {
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('GitHub Web OAuth is not configured'), { statusCode: 409 });
  }
  cleanupExpiredSessions();
  const state = randomUUID();
  webSessions.set(state, { callbackUrl, returnTo: safeReturnTo(returnTo), expiresAt: Date.now() + 10 * 60_000 });
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl);
  authorize.searchParams.set('scope', scopes);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');
  return authorize.toString();
}

export async function completeWebLogin(code: string, state: string) {
  cleanupExpiredSessions();
  const session = webSessions.get(state);
  if (!session) throw Object.assign(new Error('GitHub OAuth state is invalid or expired'), { statusCode: 400 });
  webSessions.delete(state);

  const token = await githubJson<{ access_token?: string; token_type?: string; scope?: string; error?: string; error_description?: string }>(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: session.callbackUrl
      }).toString()
    }
  );
  if (!token.access_token) throw Object.assign(new Error(token.error_description || token.error || 'GitHub did not return an access token'), { statusCode: 502 });
  const user = await saveOAuthToken({ accessToken: token.access_token, tokenType: token.token_type, scope: token.scope });
  return { user, returnTo: session.returnTo, callbackUrl: session.callbackUrl };
}

export async function beginDeviceLogin() {
  if (!clientId) throw Object.assign(new Error('GITHUB_OAUTH_CLIENT_ID is not configured'), { statusCode: 409 });
  cleanupExpiredSessions();
  const data = await githubJson<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval?: number;
  }>('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: scopes }).toString()
  });

  const flowId = randomUUID();
  const intervalMs = Math.max(5, Number(data.interval || 5)) * 1000;
  deviceSessions.set(flowId, {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + Number(data.expires_in || 900) * 1000,
    intervalMs,
    lastPollAt: 0
  });
  return {
    flowId,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: Number(data.expires_in || 900),
    interval: Math.round(intervalMs / 1000)
  };
}

export async function pollDeviceLogin(flowId: string) {
  cleanupExpiredSessions();
  const session = deviceSessions.get(flowId);
  if (!session) throw Object.assign(new Error('GitHub login request is invalid or expired'), { statusCode: 404 });

  const now = Date.now();
  const remainingMs = session.intervalMs - (now - session.lastPollAt);
  if (session.lastPollAt && remainingMs > 0) {
    return { status: 'pending' as const, interval: Math.ceil(remainingMs / 1000) };
  }
  session.lastPollAt = now;

  const result = await githubJson<{
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  }>('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }).toString()
  });

  if (result.access_token) {
    deviceSessions.delete(flowId);
    const user = await saveOAuthToken({ accessToken: result.access_token, tokenType: result.token_type, scope: result.scope });
    return { status: 'authorized' as const, user };
  }
  if (result.error === 'authorization_pending') return { status: 'pending' as const, interval: Math.round(session.intervalMs / 1000) };
  if (result.error === 'slow_down') {
    session.intervalMs = Math.max(session.intervalMs + 5000, Number(result.interval || 0) * 1000);
    return { status: 'pending' as const, interval: Math.round(session.intervalMs / 1000) };
  }
  if (result.error === 'expired_token' || result.error === 'access_denied') deviceSessions.delete(flowId);
  throw Object.assign(new Error(result.error_description || result.error || 'GitHub authorization failed'), { statusCode: 400 });
}

export function logoutGitHub() {
  if (storedAuth) persistStoredAuth(null);
  return getGitHubAuthStatus();
}
