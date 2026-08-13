import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyBaseLogger, FastifyRequest } from 'fastify';
import { getProjectByRepository, listProjects, recordWebhookEvent } from './db.js';
import { githubConfigured, listRuns } from './github.js';

export type RealtimeEvent = {
  type: 'dispatch' | 'run' | 'release' | 'poll' | 'action';
  projectId?: number;
  projectSlug?: string;
  repository?: string;
  source: 'forge' | 'github-webhook' | 'github-poll';
  action?: string;
  at: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(100);

export const webhookConfigured = Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim());

export function getPollIntervalMs() {
  const configured = Number(process.env.RUN_POLL_INTERVAL_MS || '');
  if (Number.isFinite(configured) && configured >= 5000) return configured;
  return githubConfigured ? 12000 : 300000;
}

export function publishRealtime(event: Omit<RealtimeEvent, 'at'> & { at?: string }) {
  const payload: RealtimeEvent = { ...event, at: event.at || new Date().toISOString() };
  bus.emit('update', payload);
}

export async function registerRealtime(app: FastifyInstance) {
  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write('retry: 3000\n\n');
    response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, webhookConfigured, pollIntervalMs: getPollIntervalMs() })}\n\n`);

    const listener = (event: RealtimeEvent) => {
      if (!response.writableEnded) response.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
    };
    bus.on('update', listener);

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      bus.off('update', listener);
    };
    request.raw.once('close', cleanup);
    response.once('close', cleanup);
  });

  app.post('/api/webhooks/github', {
    preParsing: async (request, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks);
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody = rawBody;
      const stream = Readable.from([rawBody]);
      (stream as Readable & { receivedEncodedLength?: number }).receivedEncodedLength = rawBody.length;
      return stream;
    }
  }, async (request, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
    if (!secret) return reply.code(503).send({ message: 'GITHUB_WEBHOOK_SECRET is not configured' });

    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody || Buffer.alloc(0);
    const signature = String(request.headers['x-hub-signature-256'] || '');
    if (!verifySignature(rawBody, signature, secret)) return reply.code(401).send({ message: 'Invalid webhook signature' });

    const deliveryId = String(request.headers['x-github-delivery'] || '').trim();
    const eventName = String(request.headers['x-github-event'] || '').trim();
    if (!deliveryId || !eventName) return reply.code(400).send({ message: 'Missing GitHub webhook headers' });

    const payload = (request.body || {}) as any;
    const repository = String(payload.repository?.full_name || '');
    const [owner, repo] = repository.split('/');
    const project = owner && repo ? getProjectByRepository(owner, repo) : undefined;
    const action = typeof payload.action === 'string' ? payload.action : null;
    const inserted = recordWebhookEvent(deliveryId, eventName, action, repository || null, project?.id || null);
    if (!inserted) return { ok: true, duplicate: true };

    const type: RealtimeEvent['type'] = eventName === 'release' ? 'release' : eventName === 'workflow_run' || eventName === 'workflow_job' ? 'run' : 'action';
    publishRealtime({
      type,
      projectId: project?.id,
      projectSlug: project?.slug,
      repository: repository || undefined,
      source: 'github-webhook',
      action: action || eventName
    });
    return { ok: true };
  });
}

function verifySignature(rawBody: Buffer, signature: string, secret: string) {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function startRunWatcher(log?: FastifyBaseLogger) {
  const intervalMs = getPollIntervalMs();
  const fingerprints = new Map<number, string>();
  let ticking = false;
  let stopped = false;

  const tick = async () => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      await Promise.all(listProjects().map(async (project) => {
        try {
          const runs = await listRuns(project, 8);
          const fingerprint = runs.map((run) => `${run.id}:${run.status}:${run.conclusion || ''}:${run.updatedAt}`).join('|');
          const previous = fingerprints.get(project.id);
          fingerprints.set(project.id, fingerprint);
          if (previous !== undefined && previous !== fingerprint) {
            publishRealtime({
              type: 'poll',
              projectId: project.id,
              projectSlug: project.slug,
              repository: `${project.owner}/${project.repo}`,
              source: 'github-poll',
              action: 'runs-changed'
            });
          }
        } catch (error) {
          log?.debug({ err: error, project: project.slug }, 'realtime polling failed');
        }
      }));
    } finally {
      ticking = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
