import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, formatSeries, iso, nextCounter, opsHkTasks, sql } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/errors';
import { actorId, defined, facilityCond, requireFacility } from './ops.common';

type TaskRow = typeof opsHkTasks.$inferSelect;
type SQL = ReturnType<typeof sql>;

/** Default turnaround when the requester gives no due time. */
const DEFAULT_DUE_MINUTES: Record<O.HkPriority, number | null> = { urgent: 30, normal: 240, low: null };

/** Allowed status moves: pending -> in_progress -> done -> verified; open tasks can be cancelled. */
const NEXT: Record<string, O.HkStatus[]> = {
  pending: ['in_progress', 'done', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: ['verified', 'in_progress'],
  verified: [],
  cancelled: [],
};

/** Housekeeping requests (discharge cleaning, spills, routine rounds) with assignment and supervisor verification. */
@Injectable()
export class HousekeepingService {
  constructor(private readonly db: DbService) {}

  list(q: { status?: O.HkStatus; open?: 'true' | 'false'; kind?: O.HkKind; page: number; pageSize: number }): Promise<Paginated<O.HkTask>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsHkTasks.facilityId)];
      if (q.status) conds.push(eq(opsHkTasks.status, q.status));
      if (q.kind) conds.push(eq(opsHkTasks.kind, q.kind));
      if (q.open === 'true') conds.push(sql`${opsHkTasks.status} in ('pending', 'in_progress', 'done')`);
      if (q.open === 'false') conds.push(sql`${opsHkTasks.status} in ('verified', 'cancelled')`);
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(opsHkTasks)
          .where(where)
          .orderBy(sql`case ${opsHkTasks.priority} when 'urgent' then 0 when 'normal' then 1 else 2 end`, desc(opsHkTasks.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsHkTasks).where(where),
      ]);
      return { items: rows.map(taskDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  create(input: z.output<typeof O.createHkTaskSchema>): Promise<O.HkTask> {
    const facilityId = requireFacility();
    return this.db.tx(async (tx) => {
      const number = formatSeries('HK', await nextCounter(tx, 'ops.hk_task'));
      const mins = DEFAULT_DUE_MINUTES[input.priority];
      const dueAt = input.dueAt ?? (mins === null ? null : new Date(Date.now() + mins * 60000).toISOString());
      const [row] = await tx
        .insert(opsHkTasks)
        .values({
          tenantId: currentContext()!.tenantId!,
          number,
          facilityId,
          location: input.location,
          kind: input.kind,
          priority: input.priority,
          description: input.description || null,
          assignedTo: input.assignedTo || null,
          requestedBy: actorId(),
          dueAt,
        })
        .returning();
      return taskDto(row!);
    });
  }

  update(id: string, input: z.output<typeof O.updateHkTaskSchema>): Promise<O.HkTask> {
    return this.db.tx(async (tx) => {
      const [t] = await tx.select().from(opsHkTasks).where(eq(opsHkTasks.id, id)).for('update');
      if (!t) throw notFound('Housekeeping task');
      const s = input.status;
      if (s && s !== t.status && !NEXT[t.status]!.includes(s)) {
        throw conflict('bad_transition', `A ${t.status.replace('_', ' ')} task cannot be marked ${s.replace('_', ' ')}`);
      }
      if (!s && (t.status === 'verified' || t.status === 'cancelled')) throw conflict('task_closed', `Task ${t.number} is closed`);
      const changed = s && s !== t.status;
      const details = [input.location, input.kind, input.priority, input.description, input.dueAt].some((v) => v !== undefined);
      if (details && t.status !== 'pending' && t.status !== 'in_progress') {
        throw conflict('task_closed', `Task ${t.number} is ${t.status.replace('_', ' ')}; its details can no longer change`);
      }
      const [row] = await tx
        .update(opsHkTasks)
        .set(
          defined({
            status: changed ? s : undefined,
            assignedTo: input.assignedTo,
            remarks: input.remarks,
            location: input.location,
            kind: input.kind,
            priority: input.priority,
            description: input.description === undefined ? undefined : input.description || null,
            dueAt: input.dueAt,
            startedAt: changed && s === 'in_progress' && !t.startedAt ? sql`now()` : undefined,
            doneAt: changed && s === 'done' ? sql`now()` : changed && s === 'in_progress' ? null : undefined,
            verifiedAt: changed && s === 'verified' ? sql`now()` : undefined,
            verifiedBy: changed && s === 'verified' ? actorId() : undefined,
          }),
        )
        .where(eq(opsHkTasks.id, id))
        .returning();
      return taskDto(row!);
    });
  }
}

function taskDto(r: TaskRow): O.HkTask {
  const open = r.status === 'pending' || r.status === 'in_progress';
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    location: r.location,
    kind: r.kind as O.HkKind,
    priority: r.priority as O.HkPriority,
    status: r.status as O.HkStatus,
    description: r.description,
    assignedTo: r.assignedTo,
    remarks: r.remarks,
    requestedBy: r.requestedBy,
    dueAt: iso(r.dueAt),
    overdue: open && !!r.dueAt && new Date(r.dueAt).getTime() < Date.now(),
    startedAt: iso(r.startedAt),
    doneAt: iso(r.doneAt),
    verifiedAt: iso(r.verifiedAt),
    verifiedBy: r.verifiedBy,
    createdAt: iso(r.createdAt),
  };
}
