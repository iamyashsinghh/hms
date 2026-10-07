import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { iso, type Tx } from '@hms/db';
import { integrations, type Paginated } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { AppError, conflict, notFound } from '../../common/errors/errors';
import { EventBus, type EventEnvelope } from '../../common/events/event-bus';
import { WEBHOOK_TRANSPORT, type WebhookTransport } from './adapters/webhook.transport';
import { formatApiKey, parseApiKey, randomToken, safeEqual, sha256, signWebhook } from './crypto';
import { IntegrationsRepository, type ApiKeyRow, type WebhookDeliveryRow, type WebhookEndpointRow } from './integrations.repository';

export interface ApiKeyPrincipal {
  tenantId: string;
  keyId: string;
  name: string;
  scopes: integrations.ApiScope[];
}

const unauthorized = (msg: string) => new AppError(HttpStatus.UNAUTHORIZED, 'invalid_api_key', msg);
export const TEST_TOPIC = 'integrations.webhook.test';

/** Public API keys and outbound webhooks for third-party systems. */
@Injectable()
export class DeveloperService implements OnModuleInit {
  private readonly logger = new Logger(DeveloperService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: IntegrationsRepository,
    private readonly bus: EventBus,
    @Inject(WEBHOOK_TRANSPORT) private readonly transport: WebhookTransport,
  ) {}

  onModuleInit() {
    for (const topic of integrations.WEBHOOK_EVENTS) this.bus.on(topic, (e) => this.fanOut(e).then(() => undefined));
  }

  // =====================================================================
  // API keys
  // =====================================================================

  listKeys(): Promise<integrations.ApiKey[]> {
    return this.db.tx(async (tx) => (await this.repo.apiKeys(tx)).map(apiKeyDto));
  }

  createKey(input: integrations.CreateApiKey): Promise<integrations.CreatedApiKey> {
    const d = integrations.createApiKeySchema.parse(input);
    if (d.expiresAt && new Date(d.expiresAt).getTime() <= Date.now()) throw conflict('expiry_in_past', 'Expiry must be in the future');
    const ctx = currentContext()!;
    const secret = randomToken(32);
    return this.db.tx(async (tx) => {
      const row = await this.repo.insertApiKey(tx, {
        name: d.name,
        prefix: `hmsk…${secret.slice(0, 6)}`,
        keyHash: sha256(secret),
        scopes: [...new Set(d.scopes)],
        expiresAt: d.expiresAt ?? null,
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
      return { ...apiKeyDto(row), key: formatApiKey(ctx.tenantId!, row.id, secret) };
    });
  }

  revokeKey(id: string): Promise<integrations.ApiKey> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.apiKey(tx, id);
      if (!row) throw notFound('API key');
      if (row.revokedAt) return apiKeyDto(row);
      return apiKeyDto(await this.repo.updateApiKey(tx, id, { revokedAt: new Date().toISOString(), updatedBy: currentContext()?.userId ?? null }));
    });
  }

  /** Checks a presented key. The hospital comes from the key itself, so RLS scopes the lookup. */
  async authenticate(presented: string): Promise<ApiKeyPrincipal> {
    const parsed = parseApiKey(presented);
    if (!parsed) throw unauthorized('API key is missing or malformed');
    let row: ApiKeyRow | undefined;
    try {
      row = await this.db.asTenant({ tenantId: parsed.tenantId }, async (tx) => {
        const r = await this.repo.apiKey(tx, parsed.keyId);
        if (r && safeEqual(r.keyHash, sha256(parsed.secret)) && !r.revokedAt && !(r.expiresAt && new Date(r.expiresAt).getTime() < Date.now())) {
          await this.repo.touchApiKey(tx, r.id);
          return r;
        }
        return undefined;
      });
    } catch {
      row = undefined;
    }
    if (!row) throw unauthorized('API key is not valid, revoked or expired');
    return { tenantId: parsed.tenantId, keyId: row.id, name: row.name, scopes: row.scopes as integrations.ApiScope[] };
  }

  // =====================================================================
  // Webhook endpoints
  // =====================================================================

  listEndpoints(): Promise<integrations.WebhookEndpoint[]> {
    return this.db.tx(async (tx) => (await this.repo.endpoints(tx)).map((r) => endpointDto(r)));
  }

  createEndpoint(input: integrations.WebhookEndpointInput): Promise<integrations.WebhookEndpoint> {
    const d = integrations.webhookEndpointInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      const row = await this.repo.insertEndpoint(tx, {
        url: d.url,
        description: d.description || null,
        events: [...new Set(d.events)],
        isActive: d.isActive,
        secret: newSecret(),
        createdBy: userId,
        updatedBy: userId,
      });
      return endpointDto(row, true);
    });
  }

  updateEndpoint(id: string, input: integrations.WebhookEndpointInput): Promise<integrations.WebhookEndpoint> {
    const d = integrations.webhookEndpointInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.repo.updateEndpoint(tx, id, {
        url: d.url,
        description: d.description || null,
        events: [...new Set(d.events)],
        isActive: d.isActive,
        updatedBy: currentContext()?.userId ?? null,
      });
      if (!row) throw notFound('Webhook');
      return endpointDto(row);
    });
  }

  rotateSecret(id: string): Promise<integrations.WebhookEndpoint> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.updateEndpoint(tx, id, { secret: newSecret(), updatedBy: currentContext()?.userId ?? null });
      if (!row) throw notFound('Webhook');
      return endpointDto(row, true);
    });
  }

  async sendTest(id: string): Promise<integrations.WebhookDelivery> {
    const delivery = await this.db.tx(async (tx) => {
      const ep = await this.repo.endpoint(tx, id);
      if (!ep) throw notFound('Webhook');
      return (await this.repo.insertDelivery(tx, {
        endpointId: ep.id,
        eventId: randomUUID(),
        topic: TEST_TOPIC,
        payload: { message: 'Test event from HMS. If you can read this, your webhook works.' },
      }))!;
    });
    return deliveryDto(await this.deliver(delivery.id));
  }

  deliveries(query: unknown): Promise<Paginated<integrations.WebhookDelivery>> {
    const q = integrations.webhookDeliveryQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.deliveries(tx, q);
      return { items: items.map(deliveryDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  async retry(deliveryId: string): Promise<integrations.WebhookDelivery> {
    const row = await this.db.tx((tx) => this.repo.delivery(tx, deliveryId));
    if (!row) throw notFound('Webhook delivery');
    if (row.status === 'delivered') throw conflict('already_delivered', 'This delivery already succeeded');
    return deliveryDto(await this.deliver(deliveryId));
  }

  /**
   * Outbox handler (worker): one delivery per subscribed endpoint, keyed by the event id so a
   * redelivered event does not send twice. Returns the deliveries it made.
   */
  async fanOut(event: EventEnvelope): Promise<WebhookDeliveryRow[]> {
    const created = await this.db.asTenant({ tenantId: event.tenantId }, async (tx) => {
      const endpoints = await this.repo.endpointsFor(tx, event.topic);
      const rows: WebhookDeliveryRow[] = [];
      for (const ep of endpoints) {
        const row = await this.repo.insertDelivery(tx, { endpointId: ep.id, eventId: event.id, topic: event.topic, payload: event.payload });
        if (row) rows.push(row);
      }
      return rows;
    });
    const out: WebhookDeliveryRow[] = [];
    for (const d of created) out.push(await this.deliver(d.id, event.tenantId));
    return out;
  }

  /** Signs and sends one delivery, recording the outcome. */
  private async deliver(deliveryId: string, tenantId?: string): Promise<WebhookDeliveryRow> {
    const scope = <T>(fn: (tx: Tx) => Promise<T>) => (tenantId ? this.db.asTenant({ tenantId }, fn) : this.db.tx(fn));
    const loaded = await scope(async (tx) => {
      const d = await this.repo.delivery(tx, deliveryId);
      return d ? { d, ep: await this.repo.endpoint(tx, d.endpointId) } : undefined;
    });
    if (!loaded?.ep) throw notFound('Webhook delivery');
    const { d, ep } = loaded;
    const body = JSON.stringify({ id: d.eventId, topic: d.topic, createdAt: iso(d.createdAt), data: d.payload });
    const res = ep.isActive || d.topic === TEST_TOPIC
      ? await this.transport.send(ep.url, body, { 'x-hms-signature': signWebhook(ep.secret, body), 'x-hms-event': d.topic, 'x-hms-delivery': d.id })
      : { ok: false, status: null, error: 'Endpoint is switched off', dryRun: false };
    if (!res.ok) this.logger.warn(`webhook ${d.id} to ${ep.url} failed: ${res.error}`);
    return scope((tx) =>
      this.repo.updateDelivery(tx, d.id, {
        status: res.ok ? 'delivered' : 'failed',
        attempts: d.attempts + 1,
        responseStatus: res.status,
        lastError: res.error,
        dryRun: res.dryRun,
        deliveredAt: res.ok ? new Date().toISOString() : null,
      }),
    );
  }
}

const newSecret = () => `whsec_${randomToken(24)}`;

function apiKeyDto(r: ApiKeyRow): integrations.ApiKey {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes as integrations.ApiScope[],
    lastUsedAt: iso(r.lastUsedAt),
    expiresAt: iso(r.expiresAt),
    revokedAt: iso(r.revokedAt),
    createdAt: iso(r.createdAt),
  };
}

function endpointDto(r: WebhookEndpointRow, withSecret = false): integrations.WebhookEndpoint {
  return {
    id: r.id,
    url: r.url,
    description: r.description,
    events: r.events as integrations.WebhookEvent[],
    isActive: r.isActive,
    ...(withSecret ? { secret: r.secret } : {}),
    secretHint: `whsec_…${r.secret.slice(-4)}`,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function deliveryDto(r: WebhookDeliveryRow): integrations.WebhookDelivery {
  return {
    id: r.id,
    endpointId: r.endpointId,
    eventId: r.eventId,
    topic: r.topic,
    payload: r.payload as Record<string, unknown>,
    status: r.status as integrations.WebhookDeliveryStatus,
    attempts: r.attempts,
    responseStatus: r.responseStatus,
    lastError: r.lastError,
    dryRun: r.dryRun,
    deliveredAt: iso(r.deliveredAt),
    createdAt: iso(r.createdAt),
  };
}
