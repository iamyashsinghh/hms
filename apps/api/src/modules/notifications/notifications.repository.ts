import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notificationsCreditLedger as ledger,
  notificationsDevices as devices,
  notificationsMessages as messages,
  notificationsOptOuts as optOuts,
  notificationsRules as rules,
  notificationsSettings as settings,
  notificationsTemplates as templates,
  or,
  sql,
  tenants,
  type Tx,
} from '@hms/db';

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type TemplateRow = typeof templates.$inferSelect;
export type RuleRow = typeof rules.$inferSelect;
export type OptOutRow = typeof optOuts.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;

/** Drizzle queries for the comms schema. Always called inside a tenant transaction. */
@Injectable()
export class NotificationsRepository {
  // ---------- settings ----------

  async findSettings(tx: Tx): Promise<SettingsRow | undefined> {
    const [row] = await tx.select().from(settings).limit(1);
    return row;
  }

  /** Inserts the settings row if missing; returns true when this call created it. */
  async insertSettings(tx: Tx, values: typeof settings.$inferInsert): Promise<boolean> {
    const res = await tx.insert(settings).values(values).onConflictDoNothing().returning({ id: settings.id });
    return res.length > 0;
  }

  async updateSettings(tx: Tx, values: Partial<typeof settings.$inferInsert>): Promise<SettingsRow | undefined> {
    const [row] = await tx.update(settings).set(values).returning();
    return row;
  }

  async tenantName(tx: Tx, tenantId: string): Promise<string | undefined> {
    const [row] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row?.name;
  }

  // ---------- templates ----------

  listTemplates(tx: Tx): Promise<TemplateRow[]> {
    return tx.select().from(templates);
  }

  async findTemplate(tx: Tx, key: string, channel: string): Promise<TemplateRow | undefined> {
    const [row] = await tx.select().from(templates).where(and(eq(templates.key, key), eq(templates.channel, channel))).limit(1);
    return row;
  }

  async upsertTemplate(tx: Tx, values: typeof templates.$inferInsert): Promise<TemplateRow> {
    const [row] = await tx
      .insert(templates)
      .values(values)
      .onConflictDoUpdate({
        target: [templates.tenantId, templates.key, templates.channel],
        set: {
          subject: values.subject,
          body: values.body,
          dltTemplateId: values.dltTemplateId,
          providerTemplateName: values.providerTemplateName,
          isActive: values.isActive,
          updatedBy: values.updatedBy,
        },
      })
      .returning();
    return row!;
  }

  async deleteTemplate(tx: Tx, key: string, channel: string): Promise<boolean> {
    const res = await tx.delete(templates).where(and(eq(templates.key, key), eq(templates.channel, channel))).returning({ id: templates.id });
    return res.length > 0;
  }

  // ---------- rules ----------

  listRules(tx: Tx, eventTopic?: string): Promise<RuleRow[]> {
    return tx.select().from(rules).where(eventTopic ? eq(rules.eventTopic, eventTopic) : undefined);
  }

  async upsertRule(tx: Tx, values: typeof rules.$inferInsert): Promise<RuleRow> {
    const [row] = await tx
      .insert(rules)
      .values(values)
      .onConflictDoUpdate({
        target: [rules.tenantId, rules.eventTopic, rules.templateKey],
        set: { channels: values.channels, isActive: values.isActive, updatedBy: values.updatedBy },
      })
      .returning();
    return row!;
  }

  // ---------- messages ----------

  async insertMessage(tx: Tx, values: NewMessageRow): Promise<MessageRow> {
    const [row] = await tx.insert(messages).values(values).returning();
    return row!;
  }

  async findByIdempotencyKey(tx: Tx, key: string): Promise<MessageRow | undefined> {
    const [row] = await tx.select().from(messages).where(eq(messages.idempotencyKey, key)).limit(1);
    return row;
  }

  async findMessage(tx: Tx, id: string, lock = false): Promise<MessageRow | undefined> {
    const q = tx.select().from(messages).where(eq(messages.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row;
  }

  async updateMessage(tx: Tx, id: string, values: Partial<NewMessageRow>): Promise<MessageRow | undefined> {
    const [row] = await tx.update(messages).set(values).where(eq(messages.id, id)).returning();
    return row;
  }

  async searchMessages(
    tx: Tx,
    f: { status?: string; channel?: string; patientId?: string; q?: string },
    page: number,
    pageSize: number,
  ) {
    const term = f.q?.trim();
    const where = and(
      f.status ? eq(messages.status, f.status) : undefined,
      f.channel ? eq(messages.channel, f.channel) : undefined,
      f.patientId ? eq(messages.patientId, f.patientId) : undefined,
      term ? or(ilike(messages.recipient, `%${term}%`), ilike(messages.templateKey, `%${term}%`), ilike(messages.body, `%${term}%`)) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(messages).where(where).orderBy(desc(messages.createdAt), desc(messages.id)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(messages).where(where),
    ]);
    return { items, total };
  }

  async statusCounts(tx: Tx, since: Date): Promise<Record<string, number>> {
    const rows = await tx
      .select({ status: messages.status, n: count() })
      .from(messages)
      .where(sql`${messages.createdAt} >= ${since.toISOString()}`)
      .groupBy(messages.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  // ---------- opt-outs ----------

  async isOptedOut(tx: Tx, channel: string, address: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: optOuts.id })
      .from(optOuts)
      .where(and(eq(optOuts.address, address), inArray(optOuts.channel, [channel, 'all'])))
      .limit(1);
    return !!row;
  }

  async searchOptOuts(tx: Tx, q: string | undefined, page: number, pageSize: number) {
    const where = q ? ilike(optOuts.address, `%${q}%`) : undefined;
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(optOuts).where(where).orderBy(desc(optOuts.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(optOuts).where(where),
    ]);
    return { items, total };
  }

  async insertOptOut(tx: Tx, values: typeof optOuts.$inferInsert): Promise<OptOutRow> {
    const [row] = await tx
      .insert(optOuts)
      .values(values)
      .onConflictDoUpdate({ target: [optOuts.tenantId, optOuts.channel, optOuts.address], set: { reason: values.reason } })
      .returning();
    return row!;
  }

  async deleteOptOut(tx: Tx, id: string): Promise<boolean> {
    const res = await tx.delete(optOuts).where(eq(optOuts.id, id)).returning({ id: optOuts.id });
    return res.length > 0;
  }

  // ---------- credits ----------

  /** Serialises balance changes for the current hospital until the transaction ends. */
  async lockCredits(tx: Tx): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('comms.credits:' || app.current_tenant_id()::text, 0))`);
  }

  async balance(tx: Tx): Promise<number> {
    const [row] = await tx.select({ total: sql<string>`coalesce(sum(${ledger.amount}), 0)` }).from(ledger);
    return Number(row?.total ?? 0);
  }

  async insertLedger(tx: Tx, values: typeof ledger.$inferInsert): Promise<LedgerRow> {
    const [row] = await tx.insert(ledger).values(values).returning();
    return row!;
  }

  async hasRefund(tx: Tx, messageId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: ledger.id })
      .from(ledger)
      .where(and(eq(ledger.messageId, messageId), eq(ledger.entryType, 'refund')))
      .limit(1);
    return !!row;
  }

  async listLedger(tx: Tx, page: number, pageSize: number) {
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(ledger).orderBy(desc(ledger.createdAt), desc(ledger.id)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ total: count() }).from(ledger),
    ]);
    return { items, total };
  }

  // ---------- devices ----------

  async upsertDevice(tx: Tx, values: typeof devices.$inferInsert): Promise<DeviceRow> {
    const [row] = await tx
      .insert(devices)
      .values(values)
      .onConflictDoUpdate({
        target: [devices.tenantId, devices.token],
        set: {
          userId: values.userId ?? null,
          patientId: values.patientId ?? null,
          platform: values.platform,
          appVariant: values.appVariant,
          deviceName: values.deviceName ?? null,
          isActive: true,
          lastSeenAt: sql`now()`,
        },
      })
      .returning();
    return row!;
  }

  async deactivateDevice(tx: Tx, token: string, userId?: string): Promise<boolean> {
    const res = await tx
      .update(devices)
      .set({ isActive: false })
      .where(and(eq(devices.token, token), userId ? eq(devices.userId, userId) : undefined))
      .returning({ id: devices.id });
    return res.length > 0;
  }

  listDevices(tx: Tx, owner: { userId?: string; patientId?: string }): Promise<DeviceRow[]> {
    const who = owner.userId ? eq(devices.userId, owner.userId) : owner.patientId ? eq(devices.patientId, owner.patientId) : sql`false`;
    return tx.select().from(devices).where(and(who, eq(devices.isActive, true))).orderBy(desc(devices.lastSeenAt));
  }
}
