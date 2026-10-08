'use client';

// Front office ↔ billing: "Collect now" for a visit's charges (consultation, registration renewal) at check-in
// and in the queue, the registration fee after registering, and a link to the billing desk.
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { api } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { buttonVariants } from '@/components/ui/button';
import { CollectNow } from '@/modules/billing/collect-now';

/** True when the user can bill and take payment (the "Collect now" widget needs both). */
export function useCanCollect() {
  const collect = usePermission('billing.payment.collect');
  const finalize = usePermission('billing.invoice.finalize');
  return collect && finalize;
}

/** Pending charges of the patient that sit on this OPD visit (same cache as CollectNow). */
function useVisitChargeIds(patientId: string, visitId: string, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['billing', 'charges', 'patient', patientId],
    queryFn: () => api.billing.charges.forPatient(patientId),
    enabled,
  });
  return React.useMemo(
    () =>
      (data?.groups ?? [])
        .flatMap((g: B.ChargeGroup) => g.charges)
        .filter((c) => c.visitId === visitId)
        .map((c) => c.id),
    [data, visitId],
  );
}

/** "Collect now" for everything pending on one OPD visit; renders nothing when nothing is pending. */
export function VisitCollect({
  patientId,
  visitId,
  onDone,
}: {
  patientId: string;
  visitId: string;
  onDone?: (invoice: B.Invoice) => void;
}) {
  const canCollect = useCanCollect();
  const chargeIds = useVisitChargeIds(patientId, visitId, canCollect);
  if (!canCollect || !chargeIds.length) return null;
  return (
    <CollectNow
      patientId={patientId}
      chargeIds={chargeIds}
      invoiceSource={{ module: 'frontoffice', refId: visitId }}
      onDone={onDone}
    />
  );
}

/** After check-in / walk-in: offer "Collect now" when the hospital collects OPD fees at check-in. */
export function CheckInCollect({
  visit,
  onDone,
}: {
  visit: { id: string; patientId: string; collectNow?: boolean; chargeIds?: string[] };
  onDone?: () => void;
}) {
  const canCollect = useCanCollect();
  if (!visit.collectNow || !visit.chargeIds?.length || !canCollect) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Collect at check-in</p>
      <CollectNow
        patientId={visit.patientId}
        chargeIds={visit.chargeIds}
        invoiceSource={{ module: 'frontoffice', refId: visit.id }}
        onDone={onDone}
      />
    </div>
  );
}

/** Registration fee posted when the patient was registered (billing rule), with "Collect now". */
export function RegistrationCollect({ patientId }: { patientId: string }) {
  const canCollect = useCanCollect();
  if (!canCollect) return null;
  return (
    <CollectNow patientId={patientId} source={{ module: 'patients', refId: patientId }} compact />
  );
}

/** Opens the billing desk for the patient. */
export function BillLink({
  patientId,
  label = 'Bill',
  className,
}: {
  patientId: string;
  label?: string;
  className?: string;
}) {
  return (
    <Can permission="billing.invoice.create">
      <Link
        href={`/billing/new?patientId=${patientId}`}
        className={className ?? buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <Receipt /> {label}
      </Link>
    </Can>
  );
}
