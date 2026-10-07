import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  integrationsAbhaLinks,
  integrationsAbhaRequests,
  integrationsApiKeys,
  integrationsCareContexts,
  integrationsConsentRequests,
  integrationsDeviceMessages,
  integrationsLabDevices,
  integrationsPaymentIntents,
  integrationsScanShareTokens,
  integrationsSettings,
  integrationsWebhookDeliveries,
  integrationsWebhookEndpoints,
  sql,
  type Tx,
} from '@hms/db';

export type SettingsRow = typeof integrationsSettings.$inferSelect;
export type AbhaRequestRow = typeof integrationsAbhaRequests.$inferSelect;
export type AbhaLinkRow = typeof integrationsAbhaLinks.$inferSelect;
export type ScanShareRow = typeof integrationsScanShareTokens.$inferSelect;
export type CareContextRow = typeof integrationsCareContexts.$inferSelect;
export type ConsentRow = typeof integrationsConsentRequests.$inferSelect;
export type PaymentIntentRow = typeof integrationsPaymentIntents.$inferSelect;
export type ApiKeyRow = typeof integrationsApiKeys.$inferSelect;
export type WebhookEndpointRow = typeof integrationsWebhookEndpoints.$inferSelect;
export type WebhookDeliveryRow = typeof integrationsWebhookDeliveries.$inferSelect;
export type LabDeviceRow = typeof integrationsLabDevices.$inferSelect;
export type DeviceMessageRow = typeof integrationsDeviceMessages.$inferSelect;

type Page = { page: number; pageSize: number };
type Where = ReturnType<typeof and>;
type Insert<T extends { $inferInsert: { tenantId: string } }> = Omit<T['$inferInsert'], 'tenantId'>;

/** Inserts are scoped to the transaction's tenant (RLS WITH CHECK enforces it too). */
const CURRENT_TENANT = sql`app.current_tenant_id()` as unknown as string;

/** Drizzle queries for the integrations schema. Always called inside DbService.tx()/asTenant(). */
@Injectable()
export class IntegrationsRepository {
  private async paged<T>(tx: Tx, table: typeof integrationsAbhaLinks | typeof integrationsCareContexts | typeof integrationsConsentRequests | typeof integrationsPaymentIntents | typeof integrationsWebhookDeliveries | typeof integrationsDeviceMessages, where: Where, order: ReturnType<typeof desc>, p: Page) {
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(table).where(where).orderBy(order).limit(p.pageSize).offset((p.page - 1) * p.pageSize),
      tx.select({ total: count() }).from(table).where(where),
    ]);
    return { items: items as T[], total };
  }

  // ---------- settings ----------

  async settings(tx: Tx): Promise<SettingsRow | undefined> {
    const [row] = await tx.select().from(integrationsSettings).limit(1);
    return row;
  }

  async upsertSettings(tx: Tx, values: Insert<typeof integrationsSettings>): Promise<SettingsRow> {
    const [row] = await tx
      .insert(integrationsSettings)
      .values({ ...values, tenantId: CURRENT_TENANT })
      .onConflictDoUpdate({
        target: integrationsSettings.tenantId,
        set: {
          abdmMode: values.abdmMode,
          hfrId: values.hfrId,
          hipName: values.hipName,
          paymentProvider: values.paymentProvider,
          paymentKeyId: values.paymentKeyId,
          updatedBy: values.updatedBy,
        },
      })
      .returning();
    return row!;
  }

  // ---------- ABHA ----------

  async insertAbhaRequest(tx: Tx, values: Insert<typeof integrationsAbhaRequests>): Promise<AbhaRequestRow> {
    const [row] = await tx.insert(integrationsAbhaRequests).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async abhaRequest(tx: Tx, id: string, lock = false): Promise<AbhaRequestRow | undefined> {
    const q = tx.select().from(integrationsAbhaRequests).where(eq(integrationsAbhaRequests.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async updateAbhaRequest(tx: Tx, id: string, values: Partial<typeof integrationsAbhaRequests.$inferInsert>): Promise<AbhaRequestRow> {
    const [row] = await tx.update(integrationsAbhaRequests).set(values).where(eq(integrationsAbhaRequests.id, id)).returning();
    return row!;
  }

  async insertAbhaLink(tx: Tx, values: Insert<typeof integrationsAbhaLinks>): Promise<AbhaLinkRow> {
    const [row] = await tx.insert(integrationsAbhaLinks).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async abhaLink(tx: Tx, id: string, lock = false): Promise<AbhaLinkRow | undefined> {
    const q = tx.select().from(integrationsAbhaLinks).where(eq(integrationsAbhaLinks.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async activeLinkForPatient(tx: Tx, patientId: string): Promise<AbhaLinkRow | undefined> {
    const [row] = await tx
      .select()
      .from(integrationsAbhaLinks)
      .where(and(eq(integrationsAbhaLinks.patientId, patientId), eq(integrationsAbhaLinks.status, 'linked')))
      .limit(1);
    return row;
  }

  async activeLinkForAbha(tx: Tx, abhaNumber: string): Promise<AbhaLinkRow | undefined> {
    const [row] = await tx
      .select()
      .from(integrationsAbhaLinks)
      .where(and(eq(integrationsAbhaLinks.abhaNumber, abhaNumber), eq(integrationsAbhaLinks.status, 'linked')))
      .limit(1);
    return row;
  }

  abhaLinks(tx: Tx, q: Page & { patientId?: string; status: string }) {
    const where = and(
      q.patientId ? eq(integrationsAbhaLinks.patientId, q.patientId) : undefined,
      q.status !== 'all' ? eq(integrationsAbhaLinks.status, q.status) : undefined,
    );
    return this.paged<AbhaLinkRow>(tx, integrationsAbhaLinks, where, desc(integrationsAbhaLinks.createdAt), q);
  }

  async updateAbhaLink(tx: Tx, id: string, values: Partial<typeof integrationsAbhaLinks.$inferInsert>): Promise<AbhaLinkRow> {
    const [row] = await tx.update(integrationsAbhaLinks).set(values).where(eq(integrationsAbhaLinks.id, id)).returning();
    return row!;
  }

  // ---------- Scan and Share ----------

  async scanShareByRequest(tx: Tx, gatewayRequestId: string): Promise<ScanShareRow | undefined> {
    const [row] = await tx.select().from(integrationsScanShareTokens).where(eq(integrationsScanShareTokens.gatewayRequestId, gatewayRequestId)).limit(1);
    return row;
  }

  async insertScanShare(tx: Tx, values: Omit<Insert<typeof integrationsScanShareTokens>, 'tokenNo'>): Promise<ScanShareRow> {
    // Token numbers restart every day; the per-tenant advisory lock keeps them gap-free under concurrency.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('integrations.scan_share:' || app.current_tenant_id()::text))`);
    const [row] = await tx
      .insert(integrationsScanShareTokens)
      .values({
        ...values,
        tenantId: CURRENT_TENANT,
        tokenNo: sql`(select coalesce(max(token_no), 0) + 1 from integrations.scan_share_tokens where token_date = ${values.tokenDate})` as unknown as number,
      })
      .returning();
    return row!;
  }

  async scanShare(tx: Tx, id: string, lock = false): Promise<ScanShareRow | undefined> {
    const q = tx.select().from(integrationsScanShareTokens).where(eq(integrationsScanShareTokens.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  scanShares(tx: Tx, q: { date: string; status: string }): Promise<ScanShareRow[]> {
    return tx
      .select()
      .from(integrationsScanShareTokens)
      .where(and(eq(integrationsScanShareTokens.tokenDate, q.date), q.status !== 'all' ? eq(integrationsScanShareTokens.status, q.status) : undefined))
      .orderBy(desc(integrationsScanShareTokens.tokenNo));
  }

  async updateScanShare(tx: Tx, id: string, values: Partial<typeof integrationsScanShareTokens.$inferInsert>): Promise<ScanShareRow> {
    const [row] = await tx.update(integrationsScanShareTokens).set(values).where(eq(integrationsScanShareTokens.id, id)).returning();
    return row!;
  }

  // ---------- care contexts ----------

  /** Inserts unless the reference already exists (event handlers are at-least-once). */
  async insertCareContext(tx: Tx, values: Insert<typeof integrationsCareContexts>): Promise<CareContextRow | undefined> {
    const [row] = await tx.insert(integrationsCareContexts).values({ ...values, tenantId: CURRENT_TENANT }).onConflictDoNothing().returning();
    return row;
  }

  async careContext(tx: Tx, id: string): Promise<CareContextRow | undefined> {
    const [row] = await tx.select().from(integrationsCareContexts).where(eq(integrationsCareContexts.id, id)).limit(1);
    return row;
  }

  careContexts(tx: Tx, q: Page & { patientId?: string; status: string }) {
    const where = and(
      q.patientId ? eq(integrationsCareContexts.patientId, q.patientId) : undefined,
      q.status !== 'all' ? eq(integrationsCareContexts.status, q.status) : undefined,
    );
    return this.paged<CareContextRow>(tx, integrationsCareContexts, where, desc(integrationsCareContexts.createdAt), q);
  }

  async updateCareContext(tx: Tx, id: string, values: Partial<typeof integrationsCareContexts.$inferInsert>): Promise<CareContextRow> {
    const [row] = await tx.update(integrationsCareContexts).set(values).where(eq(integrationsCareContexts.id, id)).returning();
    return row!;
  }

  // ---------- consents ----------

  async insertConsent(tx: Tx, values: Insert<typeof integrationsConsentRequests>): Promise<ConsentRow> {
    const [row] = await tx.insert(integrationsConsentRequests).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async consent(tx: Tx, id: string): Promise<ConsentRow | undefined> {
    const [row] = await tx.select().from(integrationsConsentRequests).where(eq(integrationsConsentRequests.id, id)).limit(1);
    return row;
  }

  consents(tx: Tx, q: Page & { patientId?: string; status: string }) {
    const where = and(
      q.patientId ? eq(integrationsConsentRequests.patientId, q.patientId) : undefined,
      q.status !== 'all' ? eq(integrationsConsentRequests.status, q.status) : undefined,
    );
    return this.paged<ConsentRow>(tx, integrationsConsentRequests, where, desc(integrationsConsentRequests.createdAt), q);
  }

  async updateConsent(tx: Tx, id: string, values: Partial<typeof integrationsConsentRequests.$inferInsert>): Promise<ConsentRow> {
    const [row] = await tx.update(integrationsConsentRequests).set(values).where(eq(integrationsConsentRequests.id, id)).returning();
    return row!;
  }

  // ---------- payment intents ----------

  async insertIntent(tx: Tx, values: Insert<typeof integrationsPaymentIntents>): Promise<PaymentIntentRow> {
    const [row] = await tx.insert(integrationsPaymentIntents).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async intent(tx: Tx, id: string, lock = false): Promise<PaymentIntentRow | undefined> {
    const q = tx.select().from(integrationsPaymentIntents).where(eq(integrationsPaymentIntents.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async intentByOrder(tx: Tx, provider: string, orderId: string): Promise<PaymentIntentRow | undefined> {
    const [row] = await tx
      .select()
      .from(integrationsPaymentIntents)
      .where(and(eq(integrationsPaymentIntents.provider, provider), eq(integrationsPaymentIntents.providerOrderId, orderId)))
      .limit(1)
      .for('update');
    return row;
  }

  async openIntentForInvoice(tx: Tx, invoiceId: string): Promise<PaymentIntentRow | undefined> {
    const [row] = await tx
      .select()
      .from(integrationsPaymentIntents)
      .where(and(eq(integrationsPaymentIntents.invoiceId, invoiceId), eq(integrationsPaymentIntents.status, 'created')))
      .limit(1);
    return row;
  }

  intents(tx: Tx, q: Page & { invoiceId?: string; status: string }) {
    const where = and(
      q.invoiceId ? eq(integrationsPaymentIntents.invoiceId, q.invoiceId) : undefined,
      q.status !== 'all' ? eq(integrationsPaymentIntents.status, q.status) : undefined,
    );
    return this.paged<PaymentIntentRow>(tx, integrationsPaymentIntents, where, desc(integrationsPaymentIntents.createdAt), q);
  }

  async updateIntent(tx: Tx, id: string, values: Partial<typeof integrationsPaymentIntents.$inferInsert>): Promise<PaymentIntentRow> {
    const [row] = await tx.update(integrationsPaymentIntents).set(values).where(eq(integrationsPaymentIntents.id, id)).returning();
    return row!;
  }

  // ---------- API keys ----------

  async insertApiKey(tx: Tx, values: Insert<typeof integrationsApiKeys>): Promise<ApiKeyRow> {
    const [row] = await tx.insert(integrationsApiKeys).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async apiKey(tx: Tx, id: string): Promise<ApiKeyRow | undefined> {
    const [row] = await tx.select().from(integrationsApiKeys).where(eq(integrationsApiKeys.id, id)).limit(1);
    return row;
  }

  apiKeys(tx: Tx): Promise<ApiKeyRow[]> {
    return tx.select().from(integrationsApiKeys).orderBy(desc(integrationsApiKeys.createdAt));
  }

  async updateApiKey(tx: Tx, id: string, values: Partial<typeof integrationsApiKeys.$inferInsert>): Promise<ApiKeyRow> {
    const [row] = await tx.update(integrationsApiKeys).set(values).where(eq(integrationsApiKeys.id, id)).returning();
    return row!;
  }

  /** Records use at most once a minute, so busy integrations do not write on every call. */
  async touchApiKey(tx: Tx, id: string): Promise<void> {
    await tx.execute(sql`update integrations.api_keys set last_used_at = now()
      where id = ${id} and (last_used_at is null or last_used_at < now() - interval '1 minute')`);
  }

  // ---------- webhooks ----------

  async insertEndpoint(tx: Tx, values: Insert<typeof integrationsWebhookEndpoints>): Promise<WebhookEndpointRow> {
    const [row] = await tx.insert(integrationsWebhookEndpoints).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async endpoint(tx: Tx, id: string): Promise<WebhookEndpointRow | undefined> {
    const [row] = await tx.select().from(integrationsWebhookEndpoints).where(eq(integrationsWebhookEndpoints.id, id)).limit(1);
    return row;
  }

  endpoints(tx: Tx): Promise<WebhookEndpointRow[]> {
    return tx.select().from(integrationsWebhookEndpoints).orderBy(desc(integrationsWebhookEndpoints.createdAt));
  }

  endpointsFor(tx: Tx, topic: string): Promise<WebhookEndpointRow[]> {
    return tx
      .select()
      .from(integrationsWebhookEndpoints)
      .where(and(eq(integrationsWebhookEndpoints.isActive, true), sql`${topic} = any(${integrationsWebhookEndpoints.events})`));
  }

  async updateEndpoint(tx: Tx, id: string, values: Partial<typeof integrationsWebhookEndpoints.$inferInsert>): Promise<WebhookEndpointRow | undefined> {
    const [row] = await tx.update(integrationsWebhookEndpoints).set(values).where(eq(integrationsWebhookEndpoints.id, id)).returning();
    return row;
  }

  async insertDelivery(tx: Tx, values: Insert<typeof integrationsWebhookDeliveries>): Promise<WebhookDeliveryRow | undefined> {
    const [row] = await tx.insert(integrationsWebhookDeliveries).values({ ...values, tenantId: CURRENT_TENANT }).onConflictDoNothing().returning();
    return row;
  }

  async delivery(tx: Tx, id: string, lock = false): Promise<WebhookDeliveryRow | undefined> {
    const q = tx.select().from(integrationsWebhookDeliveries).where(eq(integrationsWebhookDeliveries.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  deliveries(tx: Tx, q: Page & { endpointId?: string; status: string }) {
    const where = and(
      q.endpointId ? eq(integrationsWebhookDeliveries.endpointId, q.endpointId) : undefined,
      q.status !== 'all' ? eq(integrationsWebhookDeliveries.status, q.status) : undefined,
    );
    return this.paged<WebhookDeliveryRow>(tx, integrationsWebhookDeliveries, where, desc(integrationsWebhookDeliveries.createdAt), q);
  }

  async updateDelivery(tx: Tx, id: string, values: Partial<typeof integrationsWebhookDeliveries.$inferInsert>): Promise<WebhookDeliveryRow> {
    const [row] = await tx.update(integrationsWebhookDeliveries).set(values).where(eq(integrationsWebhookDeliveries.id, id)).returning();
    return row!;
  }

  // ---------- lab devices ----------

  async insertDevice(tx: Tx, values: Insert<typeof integrationsLabDevices>): Promise<LabDeviceRow> {
    const [row] = await tx.insert(integrationsLabDevices).values({ ...values, tenantId: CURRENT_TENANT }).returning();
    return row!;
  }

  async device(tx: Tx, id: string): Promise<LabDeviceRow | undefined> {
    const [row] = await tx.select().from(integrationsLabDevices).where(eq(integrationsLabDevices.id, id)).limit(1);
    return row;
  }

  async deviceByCode(tx: Tx, code: string): Promise<LabDeviceRow | undefined> {
    const [row] = await tx.select().from(integrationsLabDevices).where(eq(integrationsLabDevices.code, code)).limit(1);
    return row;
  }

  devices(tx: Tx): Promise<LabDeviceRow[]> {
    return tx.select().from(integrationsLabDevices).orderBy(integrationsLabDevices.code);
  }

  async updateDevice(tx: Tx, id: string, values: Partial<typeof integrationsLabDevices.$inferInsert>): Promise<LabDeviceRow | undefined> {
    const [row] = await tx.update(integrationsLabDevices).set(values).where(eq(integrationsLabDevices.id, id)).returning();
    return row;
  }

  /** Inserts the message; returns undefined when the device already sent this control id. */
  async insertDeviceMessage(tx: Tx, values: Insert<typeof integrationsDeviceMessages>): Promise<DeviceMessageRow | undefined> {
    const [row] = await tx.insert(integrationsDeviceMessages).values({ ...values, tenantId: CURRENT_TENANT }).onConflictDoNothing().returning();
    return row;
  }

  async deviceMessageByControl(tx: Tx, deviceId: string, controlId: string): Promise<DeviceMessageRow | undefined> {
    const [row] = await tx
      .select()
      .from(integrationsDeviceMessages)
      .where(and(eq(integrationsDeviceMessages.deviceId, deviceId), eq(integrationsDeviceMessages.controlId, controlId)))
      .limit(1);
    return row;
  }

  async deviceMessage(tx: Tx, id: string): Promise<DeviceMessageRow | undefined> {
    const [row] = await tx.select().from(integrationsDeviceMessages).where(eq(integrationsDeviceMessages.id, id)).limit(1);
    return row;
  }

  deviceMessages(tx: Tx, q: Page & { deviceId?: string; sampleId?: string; status: string }) {
    const where = and(
      q.deviceId ? eq(integrationsDeviceMessages.deviceId, q.deviceId) : undefined,
      q.sampleId ? eq(integrationsDeviceMessages.sampleId, q.sampleId) : undefined,
      q.status !== 'all' ? eq(integrationsDeviceMessages.status, q.status) : undefined,
    );
    return this.paged<DeviceMessageRow>(tx, integrationsDeviceMessages, where, desc(integrationsDeviceMessages.receivedAt), q);
  }
}
