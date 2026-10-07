import { Injectable, OnModuleInit } from '@nestjs/common';
import type { billing, emr } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EventBus } from '../../common/events/event-bus';
import { FollowUpsService } from './followups.service';
import { ReferralsService } from './referrals.service';

/** Portal publishes this when a patient rates a visit (portal.FeedbackSubmittedEvent). */
interface FeedbackSubmitted {
  feedbackId: string;
  patientId: string;
  rating: number;
}

/**
 * CRM reacts to other modules' events (worker, at least once; every handler is idempotent):
 * - billing.invoice.finalized  -> accrue referral commission
 * - billing.invoice.cancelled  -> cancel or reverse that commission
 * - emr.encounter.signed       -> follow-up reminder when the doctor set a follow-up date
 * - portal.feedback.submitted  -> feedback-recovery follow-up for low ratings
 */
@Injectable()
export class CrmEventsService implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly db: DbService,
    private readonly referrals: ReferralsService,
    private readonly followUps: FollowUpsService,
  ) {}

  onModuleInit() {
    this.bus.on<billing.InvoiceFinalizedEvent>('billing.invoice.finalized', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, async (tx) => {
        await this.referrals.accrueForInvoice(tx, e.tenantId, e.payload);
      }),
    );
    this.bus.on<billing.InvoiceCancelledEvent>('billing.invoice.cancelled', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, (tx) => this.referrals.reverseForInvoice(tx, e.tenantId, e.payload.invoiceId)),
    );
    this.bus.on<emr.EncounterSignedEvent & { followUpDate?: string | null; followUpNotes?: string | null }>('emr.encounter.signed', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, (tx) => this.followUps.fromEncounter(tx, e.tenantId, e.payload)),
    );
    this.bus.on<FeedbackSubmitted>('portal.feedback.submitted', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, (tx) => this.followUps.fromFeedback(tx, e.tenantId, e.payload)),
    );
  }
}
