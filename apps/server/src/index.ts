import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerApi } from './routes.js';
import { registerRealtime, startRunWatcher } from './realtime.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
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
  const statusCode = (error as any).statusCode || (error.name === 'ZodError' ? 400 : 500);
  app.log.error(error);
  reply.code(statusCode).send({ message: error.message || 'Internal server error' });
});

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
const stopWatcher = startRunWatcher(app.log);

const shutdown = async () => {
  stopWatcher();
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
