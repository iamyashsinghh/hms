import { Injectable } from '@nestjs/common';
import type { portal } from '@hms/shared';
import { FrontofficeService } from '../frontoffice/frontoffice.service';
import { SetupService } from '../setup/setup.service';

/** Front office appointment states that still hold the doctor's time. */
const BUSY = ['booked', 'checked_in', 'in_consultation', 'completed'];

/**
 * The portal's calls into other modules (contracts in PARALLEL_PLAN.md section 4):
 * doctors and timetables from setup, bookings and the doctor's diary from front office.
 * Kept in one place so tests and later contract changes touch a single file.
 */
@Injectable()
export class PortalGateway {
  constructor(
    private readonly setup: SetupService,
    private readonly frontoffice: FrontofficeService,
  ) {}

  async listDoctors(q: portal.DoctorQuery): Promise<portal.PortalDoctor[]> {
    const doctors = await this.setup.listDoctors(q);
    return doctors.map((d) => ({
      userId: d.userId,
      name: d.name,
      departmentId: d.departmentId,
      specialization: d.specialization ?? d.departmentName,
      consultationFee: d.consultationFee ?? null,
    }));
  }

  /** The doctor's timetable for an IST date (empty on leave days or without a schedule). */
  async slots(doctorId: string, date: string): Promise<Array<{ start: string; end: string; facilityId: string }>> {
    const slots = await this.setup.getDoctorSchedule(doctorId, date);
    return slots.map((s) => ({ start: s.start, end: s.end, facilityId: s.facilityId }));
  }

  /** Time ranges already taken in front office's diary for that doctor and date. */
  async busy(doctorId: string, date: string): Promise<Array<{ start: number; end: number }>> {
    const res = await this.frontoffice.list({ date, doctorId, page: 1, pageSize: 200 });
    return res.items
      .filter((a) => BUSY.includes(a.status))
      .map((a) => ({ start: new Date(a.slotStart).getTime(), end: new Date(a.slotEnd).getTime() }));
  }

  async book(input: { patientId: string; doctorId: string; facilityId: string; slotStart: string; slotEnd: string; reason?: string | null }) {
    const minutes = Math.round((new Date(input.slotEnd).getTime() - new Date(input.slotStart).getTime()) / 60_000);
    const appt = await this.frontoffice.book({
      patientId: input.patientId,
      doctorId: input.doctorId,
      facilityId: input.facilityId,
      slotStart: input.slotStart,
      durationMinutes: Math.min(240, Math.max(5, minutes)),
      type: 'new',
      source: 'portal',
      reason: input.reason ?? undefined,
    });
    return { appointmentId: appt.id };
  }

  async cancel(appointmentId: string, reason: string): Promise<void> {
    await this.frontoffice.cancel(appointmentId, { reason });
  }
}
