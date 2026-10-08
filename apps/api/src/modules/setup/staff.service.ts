import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  billingServices,
  eq,
  facilities,
  inArray,
  iso,
  setupDepartments,
  setupDoctorLeaves,
  setupDoctorSchedules,
  setupSpecializations,
  setupStaffProfiles,
  sql,
  users,
  type Tx,
} from '@hms/db';
import { setup as S } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { ctx, hhmm, money, num } from './setup.util';

interface StaffRow extends Record<string, unknown> {
  user_id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: S.StaffMember['status'];
  roles: string[];
  profile_id: string | null;
  staff_type: string | null;
  employee_code: string | null;
  designation: string | null;
  department_id: string | null;
  department_name: string | null;
  specialization_id: string | null;
  specialization_name: string | null;
  qualification: string | null;
  registration_no: string | null;
  registration_council: string | null;
  gender: string | null;
  date_of_joining: string | null;
  consultation_fee: string | null;
  follow_up_fee: string | null;
  follow_up_days: number | null;
  signature_url: string | null;
}

/** "Is a doctor" = holds the doctor role or has a doctor staff profile. */
const IS_DOCTOR = sql`(sp.staff_type = 'doctor' or exists (
  select 1 from iam.user_roles ur join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
   where ur.tenant_id = u.tenant_id and ur.user_id = u.id and r.key = 'doctor'))`;

const STAFF_SELECT = sql`
  select u.id as user_id, u.name, u.email, u.mobile, u.status,
         coalesce((select array_agg(distinct r.key order by r.key) from iam.user_roles ur
                     join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
                    where ur.tenant_id = u.tenant_id and ur.user_id = u.id), '{}') as roles,
         sp.id as profile_id, sp.staff_type, sp.employee_code, sp.designation,
         sp.department_id, d.name as department_name, sp.specialization_id, s.name as specialization_name,
         sp.qualification, sp.registration_no, sp.registration_council, sp.gender,
         to_char(sp.date_of_joining, 'YYYY-MM-DD') as date_of_joining,
         sp.consultation_fee::text as consultation_fee, sp.follow_up_fee::text as follow_up_fee, sp.follow_up_days, sp.signature_url
    from iam.users u
    left join setup.staff_profiles sp on sp.tenant_id = u.tenant_id and sp.user_id = u.id
    left join setup.departments d on d.tenant_id = sp.tenant_id and d.id = sp.department_id
    left join setup.specializations s on s.tenant_id = sp.tenant_id and s.id = sp.specialization_id`;

/** Staff profiles, the doctor directory, weekly OPD schedules, leaves and slots. */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- staff profiles ----------

  listStaff(q: S.StaffQuery): Promise<S.StaffMember[]> {
    const term = q.q?.trim().toLowerCase();
    return this.db.tx(async (tx) => {
      const res = await tx.execute<StaffRow>(sql`${STAFF_SELECT}
        where true
          ${q.includeInactive ? sql`` : sql`and u.status <> 'disabled'`}
          ${term ? sql`and (lower(u.name) like ${'%' + term + '%'} or lower(coalesce(u.email, '')) like ${term + '%'}
                            or u.mobile like ${term + '%'} or lower(coalesce(sp.employee_code, '')) = ${term})` : sql``}
          ${q.departmentId ? sql`and sp.department_id = ${q.departmentId}` : sql``}
          ${q.staffType ? sql`and sp.staff_type = ${q.staffType}` : sql``}
        order by u.name`);
      return res.rows.map(staffDto);
    });
  }

  getStaff(userId: string): Promise<S.StaffMember> {
    return this.db.tx((tx) => this.readStaff(tx, userId));
  }

  private async readStaff(tx: Tx, userId: string): Promise<S.StaffMember> {
    const res = await tx.execute<StaffRow>(sql`${STAFF_SELECT} where u.id = ${userId}`);
    if (!res.rows[0]) throw notFound('Staff member');
    return staffDto(res.rows[0]);
  }

  upsertProfile(userId: string, input: S.UpsertStaffProfile): Promise<S.StaffMember> {
    return this.db.tx(async (tx) => {
      await this.writeProfile(tx, userId, input);
      return this.readStaff(tx, userId);
    });
  }

  /** Also used by user creation, inside its transaction. */
  async writeProfile(tx: Tx, userId: string, input: S.UpsertStaffProfile): Promise<void> {
    const c = ctx();
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw notFound('Staff member');
    // A switched-off department/specialization is refused only when newly picked, so old profiles still save.
    const [current] = await tx
      .select({ departmentId: setupStaffProfiles.departmentId, specializationId: setupStaffProfiles.specializationId })
      .from(setupStaffProfiles)
      .where(eq(setupStaffProfiles.userId, userId))
      .limit(1);
    if (input.departmentId) {
      const [d] = await tx.select({ isActive: setupDepartments.isActive }).from(setupDepartments).where(eq(setupDepartments.id, input.departmentId)).limit(1);
      if (!d) throw badRequest('invalid_department', 'Department not found');
      if (!d.isActive && current?.departmentId !== input.departmentId) throw badRequest('inactive_department', 'This department is switched off; pick an active one');
    }
    if (input.specializationId) {
      const [sp] = await tx.select({ isActive: setupSpecializations.isActive }).from(setupSpecializations).where(eq(setupSpecializations.id, input.specializationId)).limit(1);
      if (!sp) throw badRequest('invalid_specialization', 'Specialization not found');
      if (!sp.isActive && current?.specializationId !== input.specializationId) throw badRequest('inactive_specialization', 'This specialization is switched off; pick an active one');
    }
    if (input.employeeCode) {
      const [dup] = await tx
        .select({ userId: setupStaffProfiles.userId })
        .from(setupStaffProfiles)
        .where(and(sql`lower(${setupStaffProfiles.employeeCode}) = lower(${input.employeeCode})`, sql`${setupStaffProfiles.userId} <> ${userId}`))
        .limit(1);
      if (dup) throw conflict('duplicate_employee_code', `Employee code ${input.employeeCode} is already given to another staff member`);
    }
    const values = {
      staffType: input.staffType,
      employeeCode: input.employeeCode || null,
      designation: input.designation || null,
      departmentId: input.departmentId ?? null,
      specializationId: input.specializationId ?? null,
      qualification: input.qualification || null,
      registrationNo: input.registrationNo || null,
      registrationCouncil: input.registrationCouncil || null,
      gender: input.gender ?? null,
      dateOfJoining: input.dateOfJoining ?? null,
      consultationFee: money(input.consultationFee),
      followUpFee: money(input.followUpFee),
      followUpDays: input.followUpDays ?? null,
      signatureUrl: input.signatureUrl ?? null,
      updatedBy: c.userId,
    };
    await tx
      .insert(setupStaffProfiles)
      .values({ ...values, tenantId: c.tenantId, userId, createdBy: c.userId })
      .onConflictDoUpdate({ target: [setupStaffProfiles.tenantId, setupStaffProfiles.userId], set: values });
    await this.syncFeeServices(tx, userId);
  }

  // ---------- doctor fees → billing services ----------

  /**
   * Keeps the doctor's fees in the billing service master (S.doctorFeeServiceCodes), inside the caller's
   * transaction, so the consultation charge posted at check-in is priced from there and payer price lists
   * apply. A fee above 0 makes the service active at that price (name follows the doctor's name); a cleared
   * or zero fee switches it off. GST, HSN/SAC and price lists set in Billing are left alone.
   * Written straight to billing.services because BillingService.createService opens its own transaction.
   */
  async syncFeeServices(tx: Tx, userId: string): Promise<void> {
    const res = await tx.execute<{ name: string; consultation_fee: string | null; follow_up_fee: string | null }>(sql`
      select u.name, sp.consultation_fee::text as consultation_fee, sp.follow_up_fee::text as follow_up_fee
        from iam.users u left join setup.staff_profiles sp on sp.tenant_id = u.tenant_id and sp.user_id = u.id
       where u.id = ${userId}`);
    const row = res.rows[0];
    if (!row) return;
    const codes = S.doctorFeeServiceCodes(userId);
    const doctor = `Dr. ${row.name.replace(/^Dr\.?\s*/i, '')}`;
    await this.syncFeeService(tx, codes.consultation, `Consultation - ${doctor}`, num(row.consultation_fee));
    await this.syncFeeService(tx, codes.followUp, `Follow-up consultation - ${doctor}`, num(row.follow_up_fee));
  }

  private async syncFeeService(tx: Tx, code: string, name: string, fee: number | null): Promise<void> {
    const c = ctx();
    const active = fee !== null && fee > 0;
    const [existing] = await tx.select().from(billingServices).where(eq(billingServices.code, code)).limit(1);
    if (!existing) {
      if (!active) return;
      // Two check-ins can create it at once: the second one just keeps the first row.
      await tx
        .insert(billingServices)
        .values({ tenantId: c.tenantId, code, name, category: 'consultation', basePrice: money(fee)!, taxRate: '0', isActive: true, createdBy: c.userId, updatedBy: c.userId })
        .onConflictDoNothing();
      return;
    }
    const price = active ? money(fee)! : existing.basePrice;
    if (existing.name === name && Number(existing.basePrice) === Number(price) && existing.isActive === active) return;
    await tx
      .update(billingServices)
      .set({ name, basePrice: price, isActive: active, updatedBy: c.userId })
      .where(eq(billingServices.id, existing.id));
  }

  // ---------- doctors (cross-module contract) ----------

  listDoctors(q: S.DoctorQuery = {}): Promise<S.Doctor[]> {
    return this.db.tx((tx) => this.readDoctors(tx, q));
  }

  /** Active doctors, optionally only those working in a facility and/or department. */
  async readDoctors(tx: Tx, q: S.DoctorQuery = {}): Promise<S.Doctor[]> {
    const res = await tx.execute<StaffRow>(sql`${STAFF_SELECT}
      where u.status = 'active' and ${IS_DOCTOR}
        ${q.departmentId ? sql`and sp.department_id = ${q.departmentId}` : sql``}
        ${q.facilityId ? sql`and (exists (select 1 from setup.doctor_schedules ds where ds.tenant_id = u.tenant_id and ds.user_id = u.id and ds.facility_id = ${q.facilityId})
             or exists (select 1 from iam.user_roles ur where ur.tenant_id = u.tenant_id and ur.user_id = u.id
                         and (ur.facility_id is null or ur.facility_id = ${q.facilityId})))` : sql``}
      order by u.name`);
    return res.rows.map(doctorDto);
  }

  async getDoctor(tx: Tx, userId: string): Promise<S.Doctor> {
    const res = await tx.execute<StaffRow>(sql`${STAFF_SELECT} where u.id = ${userId} and ${IS_DOCTOR}`);
    if (!res.rows[0]) throw notFound('Doctor');
    return doctorDto(res.rows[0]);
  }

  // ---------- weekly schedule ----------

  getSchedule(userId: string): Promise<S.ScheduleBlock[]> {
    return this.db.tx(async (tx) => {
      await this.getDoctor(tx, userId);
      return this.readSchedule(tx, userId);
    });
  }

  private async readSchedule(tx: Tx, userId: string): Promise<S.ScheduleBlock[]> {
    const rows = await tx
      .select()
      .from(setupDoctorSchedules)
      .where(eq(setupDoctorSchedules.userId, userId))
      .orderBy(asc(setupDoctorSchedules.weekday), asc(setupDoctorSchedules.startTime));
    return rows.map((r) => ({
      id: r.id,
      facilityId: r.facilityId,
      weekday: r.weekday,
      startTime: hhmm(r.startTime),
      endTime: hhmm(r.endTime),
      slotMinutes: r.slotMinutes,
      maxPatients: r.maxPatients,
    }));
  }

  /** Replaces the doctor's whole weekly timetable. Blocks on the same day may not overlap. */
  replaceSchedule(userId: string, input: S.ReplaceSchedule): Promise<S.ScheduleBlock[]> {
    const c = ctx();
    const blocks = S.replaceScheduleSchema.parse(input).blocks;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]!;
        const b = blocks[j]!;
        if (a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime) {
          throw badRequest('schedule_overlap', `Two timings overlap on the same day (${a.startTime}-${a.endTime} and ${b.startTime}-${b.endTime})`);
        }
      }
    }
    return this.db.tx(async (tx) => {
      await this.getDoctor(tx, userId);
      const facilityIds = [...new Set(blocks.map((b) => b.facilityId))];
      if (facilityIds.length) {
        const found = await tx.select({ id: facilities.id }).from(facilities).where(inArray(facilities.id, facilityIds));
        if (found.length !== facilityIds.length) throw badRequest('invalid_facility', 'Facility not found');
      }
      await tx.delete(setupDoctorSchedules).where(eq(setupDoctorSchedules.userId, userId));
      if (blocks.length) {
        await tx.insert(setupDoctorSchedules).values(
          blocks.map((b) => ({
            tenantId: c.tenantId,
            userId,
            facilityId: b.facilityId,
            weekday: b.weekday,
            startTime: b.startTime,
            endTime: b.endTime,
            slotMinutes: b.slotMinutes,
            maxPatients: b.maxPatients ?? null,
          })),
        );
      }
      await this.outbox.publish(tx, 'setup.doctor.schedule_changed', { userId });
      return this.readSchedule(tx, userId);
    });
  }

  /** True when the doctor has any weekly timing (optionally in one facility). */
  async hasSchedule(tx: Tx, userId: string, facilityId?: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: setupDoctorSchedules.id })
      .from(setupDoctorSchedules)
      .where(and(eq(setupDoctorSchedules.userId, userId), facilityId ? eq(setupDoctorSchedules.facilityId, facilityId) : undefined))
      .limit(1);
    return !!row;
  }

  // ---------- leaves ----------

  listLeaves(userId: string): Promise<S.DoctorLeave[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(setupDoctorLeaves)
        .where(and(eq(setupDoctorLeaves.userId, userId), sql`${setupDoctorLeaves.toDate} >= current_date - 90`))
        .orderBy(asc(setupDoctorLeaves.fromDate));
      return rows.map(leaveDto);
    });
  }

  addLeave(userId: string, input: S.CreateLeave): Promise<S.DoctorLeave> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      await this.getDoctor(tx, userId);
      const [overlap] = await tx
        .select({ fromDate: setupDoctorLeaves.fromDate, toDate: setupDoctorLeaves.toDate })
        .from(setupDoctorLeaves)
        .where(and(eq(setupDoctorLeaves.userId, userId), sql`${setupDoctorLeaves.fromDate} <= ${input.toDate}`, sql`${setupDoctorLeaves.toDate} >= ${input.fromDate}`))
        .limit(1);
      if (overlap) throw conflict('leave_overlap', `This leave overlaps an existing leave (${overlap.fromDate} to ${overlap.toDate})`);
      const [row] = await tx
        .insert(setupDoctorLeaves)
        .values({ tenantId: c.tenantId, userId, fromDate: input.fromDate, toDate: input.toDate, reason: input.reason || null, createdBy: c.userId })
        .returning();
      await this.outbox.publish(tx, 'setup.doctor.leave_added', { userId, leaveId: row!.id, fromDate: row!.fromDate, toDate: row!.toDate });
      return leaveDto(row!);
    });
  }

  deleteLeave(userId: string, leaveId: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const res = await tx
        .delete(setupDoctorLeaves)
        .where(and(eq(setupDoctorLeaves.userId, userId), eq(setupDoctorLeaves.id, leaveId)))
        .returning({ id: setupDoctorLeaves.id });
      if (!res.length) throw notFound('Leave');
    });
  }

  // ---------- slots (cross-module contract) ----------

  getDoctorSchedule(userId: string, date: string, facilityId?: string): Promise<S.DoctorSlot[]> {
    return this.db.tx((tx) => this.readSlots(tx, userId, date, facilityId));
  }

  /**
   * Bookable slots for a doctor on a date, in the hospital's timezone, as UTC ISO strings.
   * Empty when the doctor is on leave or does not sit that day. Booking state is frontoffice's job.
   */
  async readSlots(tx: Tx, userId: string, date: string, facilityId?: string): Promise<S.DoctorSlot[]> {
    const res = await tx.execute<{ schedule_id: string; facility_id: string; max_patients: number | null; start: string; end: string }>(sql`
      with tz as (select coalesce((select timezone from setup.hospital_profiles limit 1), 'Asia/Kolkata') as name)
      select s.id as schedule_id, s.facility_id, s.max_patients,
             to_char((g at time zone tz.name) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as start,
             to_char(((g + make_interval(mins => s.slot_minutes)) at time zone tz.name) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as end
        from tz, setup.doctor_schedules s
        cross join lateral generate_series(
          ${date}::date + s.start_time,
          ${date}::date + s.end_time - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes)) g
       where s.user_id = ${userId}
         and s.weekday = extract(dow from ${date}::date)
         ${facilityId ? sql`and s.facility_id = ${facilityId}` : sql``}
         and not exists (select 1 from setup.doctor_leaves l
                          where l.tenant_id = s.tenant_id and l.user_id = s.user_id
                            and ${date}::date between l.from_date and l.to_date)
       order by g`);
    return res.rows.map((r) => ({ start: r.start, end: r.end, facilityId: r.facility_id, scheduleId: r.schedule_id, maxPatients: r.max_patients }));
  }
}

function staffDto(r: StaffRow): S.StaffMember {
  return {
    userId: r.user_id,
    name: r.name,
    email: r.email,
    mobile: r.mobile,
    status: r.status,
    roles: r.roles,
    profile: r.profile_id
      ? {
          staffType: r.staff_type as NonNullable<S.StaffMember['profile']>['staffType'],
          employeeCode: r.employee_code,
          designation: r.designation,
          departmentId: r.department_id,
          departmentName: r.department_name,
          specializationId: r.specialization_id,
          specializationName: r.specialization_name,
          qualification: r.qualification,
          registrationNo: r.registration_no,
          registrationCouncil: r.registration_council,
          gender: r.gender,
          dateOfJoining: r.date_of_joining,
          consultationFee: num(r.consultation_fee),
          followUpFee: num(r.follow_up_fee),
          followUpDays: r.follow_up_days,
          signatureUrl: r.signature_url,
        }
      : null,
  };
}

function doctorDto(r: StaffRow): S.Doctor {
  const d: S.Doctor = {
    userId: r.user_id,
    name: r.name,
    departmentId: r.department_id,
    departmentName: r.department_name,
    specialization: r.specialization_name,
    qualification: r.qualification,
    registrationNo: r.registration_no,
    registrationCouncil: r.registration_council,
    signatureUrl: r.signature_url,
  };
  if (r.consultation_fee !== null) d.consultationFee = Number(r.consultation_fee);
  if (r.follow_up_fee !== null) d.followUpFee = Number(r.follow_up_fee);
  if (r.follow_up_days !== null) d.followUpDays = r.follow_up_days;
  return d;
}

function leaveDto(r: typeof setupDoctorLeaves.$inferSelect): S.DoctorLeave {
  return { id: r.id, fromDate: r.fromDate, toDate: r.toDate, reason: r.reason, createdAt: iso(r.createdAt) };
}
