import { Injectable } from '@nestjs/common';
import type { portal } from '@hms/shared';
import { ChargesService } from '../billing/charges.service';
import { FrontofficeService } from '../frontoffice/frontoffice.service';
import { SetupService } from '../setup/setup.service';

/**
 * The portal's calls into other modules (contracts in PARALLEL_PLAN.md section 4):
 * doctors and timetables from setup, bookings and the doctor's diary from front office, and the
 * charges on a patient's account not billed yet from billing.
 * Kept in one place so tests and later contract changes touch a single file.
 */
@Injectable()
export class PortalGateway {
  constructor(
    private readonly setup: SetupService,
    private readonly frontoffice: FrontofficeService,
    private readonly charges: ChargesService,
  ) {}

  /** Pending (not yet billed) charges per patient: count, total in paise and the oldest charge date. */
  async pendingCharges(patientIds: string[]): Promise<Map<string, { count: number; paise: number; oldestDate: string }>> {
    const out = new Map<string, { count: number; paise: number; oldestDate: string }>();
    for (const patientId of patientIds) {
      const { items } = await this.charges.list({ patientId, status: 'pending', pageSize: 500 });
      if (!items.length) continue;
      out.set(patientId, {
        count: items.length,
        paise: items.reduce((s, c) => s + Math.round(c.amount * 100), 0),
        oldestDate: items.reduce((d, c) => (c.chargeDate < d ? c.chargeDate : d), items[0]!.chargeDate),
      });
    }
    return out;
  }

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

  /**
   * Bookable slots for an IST date at the given branches: front office applies the setup timetable,
   * day offs and slot capacity, so its `available` is the source of truth.
   */
  async slots(doctorId: string, date: string, facilityIds: string[]): Promise<Array<{ start: string; end: string; facilityId: string; available: boolean }>> {
    const out = [];
    for (const facilityId of facilityIds) {
      const slots = await this.frontoffice.availableSlots(doctorId, { date, facilityId });
      out.push(...slots.map((s) => ({ start: s.start, end: s.end, facilityId: s.facilityId, available: s.available })));
    }
    return out.sort((x, y) => x.start.localeCompare(y.start));
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
