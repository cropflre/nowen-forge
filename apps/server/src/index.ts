import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerAuthApi } from './authRoutes.js';
import { registerApi } from './routes.js';
import { registerRealtime, startRunWatcher } from './realtime.js';
import { startReleasePlanWatcher } from './releasePlans.js';
import { startReleaseRecoveryWatcher } from './releaseRecovery.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await registerAuthApi(app);
await registerRealtime(app);
await registerApi(app);

const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, prefix: '/' });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ message: 'Not found' });
    return reply.sendFile('index.html');
  });
}

app.setErrorHandler((error, _request, reply) => {
  const githubStatus = Number((error as any).status || 0);
  const headers = (error as any).response?.headers || {};
  const remaining = String(headers['x-ratelimit-remaining'] ?? '');
  const message = error.message || 'Internal server error';
  const rateLimited = (githubStatus === 403 || githubStatus === 429)
    && (remaining === '0' || /rate limit/i.test(message));

  if (rateLimited) {
    const resetSeconds = Number(headers['x-ratelimit-reset'] || 0);
    const resetAt = Number.isFinite(resetSeconds) && resetSeconds > 0 ? new Date(resetSeconds * 1000).toISOString() : null;
    app.log.warn({ err: error, resetAt }, 'GitHub API rate limited');
    return reply.code(429).send({
      code: 'GITHUB_RATE_LIMITED',
      message: resetAt ? `GitHub API 请求额度已耗尽，将在 ${resetAt} 后恢复。请登录 GitHub 以提高额度。` : 'GitHub API 请求额度已耗尽，请登录 GitHub 后重试。',
      resetAt
    });
  }

  const statusCode = (error as any).statusCode || githubStatus || (error.name === 'ZodError' ? 400 : 500);
  app.log.error(error);
  reply.code(statusCode).send({ message });
});

const port = Number(process.env.PORT || 18667);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
const stopRunWatcher = startRunWatcher(app.log);
const stopReleaseWatcher = startReleasePlanWatcher(app.log);
const stopRecoveryWatcher = startReleaseRecoveryWatcher(app.log);

const shutdown = async () => {
  stopRunWatcher();
  stopReleaseWatcher();
  stopRecoveryWatcher();
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
