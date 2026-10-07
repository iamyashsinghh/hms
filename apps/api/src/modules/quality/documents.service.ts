import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, iso, qualityDocuments, sql, type Tx } from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { QualityRepository } from './quality.repository';
import { isoOrNull, istDate } from './quality.util';

type Row = typeof qualityDocuments.$inferSelect;
const canManage = () => currentContext()!.permissions.has('quality.document.manage');

/**
 * NABH document library. A document code has numbered versions: draft → approved → archived.
 * Approving a version archives the previously approved one, so each code has one current version.
 * Staff without document.manage only see approved versions.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
  ) {}

  list(q: z.output<typeof Q.documentQuerySchema>): Promise<Paginated<Q.DocumentSummary>> {
    const t = qualityDocuments;
    const manager = canManage();
    const status = manager ? q.status : 'approved';
    const where = and(
      status ? eq(t.status, status) : sql`${t.status} <> 'archived'`,
      q.chapter ? eq(t.chapter, q.chapter) : undefined,
      q.docType ? eq(t.docType, q.docType) : undefined,
      q.reviewDue === 'true' ? sql`${t.status} = 'approved' and ${t.reviewDue} <= ${addDays(istDate(), 30)}` : undefined,
      q.q ? sql`(${t.code} ilike ${'%' + q.q + '%'} or ${t.title} ilike ${'%' + q.q + '%'})` : undefined,
    );
    return this.db.tx(async (tx) => {
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(t).where(where).orderBy(asc(t.chapter), asc(t.code), desc(t.version)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(t).where(where),
      ]);
      const people = await this.repo.people(tx, rows.map((r) => r.approvedBy));
      return { items: rows.map((r) => summary(r, people)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<Q.QualityDocument> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id);
      if (!canManage() && row.status !== 'approved') throw notFound('Document');
      return this.detail(tx, row);
    });
  }

  create(input: z.output<typeof Q.createDocumentSchema>): Promise<Q.QualityDocument> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [exists] = await tx.select({ id: qualityDocuments.id }).from(qualityDocuments).where(eq(qualityDocuments.code, input.code)).limit(1);
      if (exists) throw conflict('duplicate_code', `${input.code} already exists; create a new version of it instead`);
      const [row] = await tx
        .insert(qualityDocuments)
        .values({ ...columns(input), tenantId: ctx.tenantId!, code: input.code, version: 1, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      await this.repo.addActivity(tx, 'document', row!.id, 'drafted', { to: 'draft' });
      return this.detail(tx, row!);
    });
  }

  update(id: string, input: z.output<typeof Q.updateDocumentSchema>): Promise<Q.QualityDocument> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status !== 'draft') throw conflict('document_locked', 'Only drafts can be edited; create a new version instead');
      const [updated] = await tx
        .update(qualityDocuments)
        .set({ ...columns(input), updatedBy: ctx.userId })
        .where(eq(qualityDocuments.id, id))
        .returning();
      return this.detail(tx, updated!);
    });
  }

  approve(id: string): Promise<Q.QualityDocument> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status !== 'draft') throw conflict('invalid_transition', `Version ${row.version} is already ${row.status}`);
      if (!row.content?.trim() && !row.fileUrl) throw badRequest('document_empty', 'Add the document text or a file link before approving');
      const today = istDate();
      await tx
        .update(qualityDocuments)
        .set({ status: 'archived', updatedBy: ctx.userId })
        .where(and(eq(qualityDocuments.code, row.code), eq(qualityDocuments.status, 'approved')));
      const [updated] = await tx
        .update(qualityDocuments)
        .set({
          status: 'approved',
          approvedBy: ctx.userId ?? null,
          approvedAt: new Date().toISOString(),
          effectiveFrom: row.effectiveFrom ?? today,
          reviewDue: row.reviewDue ?? addDays(row.effectiveFrom ?? today, 365),
          updatedBy: ctx.userId,
        })
        .where(eq(qualityDocuments.id, id))
        .returning();
      await this.repo.addActivity(tx, 'document', id, 'approved', { from: 'draft', to: 'approved' });
      return this.detail(tx, updated!);
    });
  }

  /** New draft version copied from the latest version of the same code. */
  revise(id: string): Promise<Q.QualityDocument> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const base = await this.find(tx, id);
      const versions = await tx.select().from(qualityDocuments).where(eq(qualityDocuments.code, base.code)).orderBy(desc(qualityDocuments.version)).for('update');
      if (versions.some((v) => v.status === 'draft')) throw conflict('draft_exists', `${base.code} already has a draft version`);
      const latest = versions[0]!;
      const [row] = await tx
        .insert(qualityDocuments)
        .values({
          tenantId: ctx.tenantId!,
          code: latest.code,
          version: latest.version + 1,
          title: latest.title,
          chapter: latest.chapter,
          docType: latest.docType,
          department: latest.department,
          content: latest.content,
          fileUrl: latest.fileUrl,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await this.repo.addActivity(tx, 'document', row!.id, 'drafted', { to: 'draft', note: `From version ${latest.version}` });
      return this.detail(tx, row!);
    });
  }

  archive(id: string): Promise<Q.QualityDocument> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status === 'archived') throw conflict('invalid_transition', 'Already archived');
      const [updated] = await tx
        .update(qualityDocuments)
        .set({ status: 'archived', updatedBy: ctx.userId })
        .where(eq(qualityDocuments.id, id))
        .returning();
      await this.repo.addActivity(tx, 'document', id, 'archived', { from: row.status, to: 'archived' });
      return this.detail(tx, updated!);
    });
  }

  private async find(tx: Tx, id: string, lock = false): Promise<Row> {
    const qb = tx.select().from(qualityDocuments).where(eq(qualityDocuments.id, id)).limit(1);
    const [row] = lock ? await qb.for('update') : await qb;
    if (!row) throw notFound('Document');
    return row;
  }

  private async detail(tx: Tx, row: Row): Promise<Q.QualityDocument> {
    const people = await this.repo.people(tx, [row.approvedBy]);
    const versions = await tx
      .select({ id: qualityDocuments.id, version: qualityDocuments.version, status: qualityDocuments.status, approvedAt: qualityDocuments.approvedAt })
      .from(qualityDocuments)
      .where(and(eq(qualityDocuments.code, row.code), canManage() ? undefined : eq(qualityDocuments.status, 'approved')))
      .orderBy(desc(qualityDocuments.version));
    return {
      ...summary(row, people),
      content: row.content,
      fileUrl: row.fileUrl,
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status as Q.DocumentStatus, approvedAt: isoOrNull(v.approvedAt) })),
    };
  }
}

function columns(input: z.output<typeof Q.updateDocumentSchema>): Partial<typeof qualityDocuments.$inferInsert> & { title: string; chapter: string; docType: string } {
  const out: Partial<typeof qualityDocuments.$inferInsert> = {};
  if (input.title !== undefined) out.title = input.title;
  if (input.chapter !== undefined) out.chapter = input.chapter;
  if (input.docType !== undefined) out.docType = input.docType;
  if (input.department !== undefined) out.department = input.department || null;
  if (input.content !== undefined) out.content = input.content || null;
  if (input.fileUrl !== undefined) out.fileUrl = input.fileUrl || null;
  if (input.effectiveFrom !== undefined) out.effectiveFrom = input.effectiveFrom;
  if (input.reviewDue !== undefined) out.reviewDue = input.reviewDue;
  return out as ReturnType<typeof columns>;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function summary(r: Row, people: Map<string, Q.Person>): Q.DocumentSummary {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    title: r.title,
    chapter: r.chapter as Q.NabhChapter,
    docType: r.docType as Q.DocumentType,
    department: r.department,
    status: r.status as Q.DocumentStatus,
    effectiveFrom: r.effectiveFrom,
    reviewDue: r.reviewDue,
    reviewOverdue: r.status === 'approved' && !!r.reviewDue && r.reviewDue < istDate(),
    approvedBy: r.approvedBy ? (people.get(r.approvedBy) ?? null) : null,
    approvedAt: isoOrNull(r.approvedAt),
    updatedAt: iso(r.updatedAt),
  };
}
