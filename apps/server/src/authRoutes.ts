import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  beginDeviceLogin,
  beginWebLogin,
  completeWebLogin,
  getGitHubAuthStatus,
  getOAuthCallbackUrl,
  logoutGitHub,
  pollDeviceLogin
} from './githubAuth.js';

function requestOrigin(request: FastifyRequest) {
  const origin = String(request.headers.origin || '').trim();
  if (/^https?:\/\/[^/]+$/i.test(origin)) return origin;
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
  const host = forwardedHost || String(request.headers.host || '').trim();
  const protocol = forwardedProto || request.protocol || 'http';
  if (host) return `${protocol}://${host}`;
  return 'http://localhost:18667';
}

function appendAuthResult(target: string, result: 'success' | 'error') {
  const url = new URL(target);
  url.searchParams.set('github_auth', result);
  return url.toString();
}

export async function registerAuthApi(app: FastifyInstance) {
  app.get('/api/auth/github/status', async () => getGitHubAuthStatus());

  app.post('/api/auth/github/web/start', async (request) => {
    const body = (request.body || {}) as { returnTo?: string };
    const callbackUrl = getOAuthCallbackUrl(requestOrigin(request));
    return { authorizeUrl: beginWebLogin(callbackUrl, body.returnTo) };
  });

  app.get('/api/auth/github/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    try {
      if (query.error) throw Object.assign(new Error(`GitHub OAuth failed: ${query.error}`), { statusCode: 400 });
      if (!query.code || !query.state) throw Object.assign(new Error('GitHub OAuth callback is missing code/state'), { statusCode: 400 });
      const result = await completeWebLogin(query.code, query.state);
      const target = new URL(result.returnTo, result.callbackUrl).toString();
      return reply.redirect(appendAuthResult(target, 'success'));
    } catch (error) {
      request.log.warn({ err: error }, 'GitHub OAuth callback failed');
      const target = new URL('/settings', requestOrigin(request)).toString();
      return reply.redirect(appendAuthResult(target, 'error'));
    }
  });

  app.post('/api/auth/github/device/start', async () => beginDeviceLogin());

  app.post('/api/auth/github/device/poll', async (request) => {
    const body = (request.body || {}) as { flowId?: string };
    if (!body.flowId) throw Object.assign(new Error('flowId is required'), { statusCode: 400 });
    return pollDeviceLogin(body.flowId);
  });

  app.post('/api/auth/github/logout', async () => logoutGitHub());
}
