import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import { setup as S } from '@hms/shared';
import { ProfileService } from './profile.service';
import { StaffService } from './staff.service';

/**
 * What other modules use from Setup (PARALLEL_PLAN.md section 4). Import SetupModule and inject SetupService.
 * Methods without a `tx` open their own transaction in the caller's hospital; the `*InTx` variants join yours.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly staff: StaffService,
    private readonly profile: ProfileService,
  ) {}

  /** Active doctors, optionally only those working in a facility and/or department. */
  listDoctors(q: S.DoctorQuery = {}): Promise<S.Doctor[]> {
    return this.staff.listDoctors(q);
  }

  listDoctorsInTx(tx: Tx, q: S.DoctorQuery = {}): Promise<S.Doctor[]> {
    return this.staff.readDoctors(tx, q);
  }

  /** One doctor (404 if the user is not a doctor). */
  getDoctorInTx(tx: Tx, userId: string): Promise<S.Doctor> {
    return this.staff.getDoctor(tx, userId);
  }

  /** Bookable slots on a date (YYYY-MM-DD) in hospital time; empty on leave days. */
  getDoctorSchedule(userId: string, date: string, facilityId?: string): Promise<S.DoctorSlot[]> {
    return this.staff.getDoctorSchedule(userId, date, facilityId);
  }

  getDoctorScheduleInTx(tx: Tx, userId: string, date: string, facilityId?: string): Promise<S.DoctorSlot[]> {
    return this.staff.readSlots(tx, userId, date, facilityId);
  }

  /** Hospital name, GSTIN, address and letterhead for printouts and invoices. */
  getProfileInTx(tx: Tx): Promise<S.HospitalProfile> {
    return this.profile.readProfile(tx);
  }

  getPrintTemplateInTx(tx: Tx, key: S.PrintTemplateKey, facilityId?: string | null): Promise<S.PrintTemplate> {
    return this.profile.readPrintTemplate(tx, key, facilityId);
  }

  /** Next number in a series with the hospital's configured prefix, e.g. nextNumber(tx, 'billing.invoice', { prefix: 'INV' }). */
  nextNumber(tx: Tx, key: string, fallback: { prefix: string; width?: number }): Promise<string> {
    return this.profile.nextNumber(tx, key, fallback);
  }
}
