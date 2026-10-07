'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Printer } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { patientApi } from '../patient-session';
import { Empty, formatDateTime, rupees, StatusBadge } from './shared';

export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['portal', 'prescriptions', patientId],
    queryFn: () => patientApi.portal.prescriptions({ patientId: patientId || undefined }),
  });
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data.length) return <Empty>Prescriptions from your doctor visits will appear here.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((rx) => (
        <Card key={rx.id} className="print:break-inside-avoid">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{rx.doctorName ?? 'Prescription'}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(rx.issuedAt)} · {rx.patientName}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="print:hidden" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
            </div>
            <ul className="divide-y rounded-md border text-sm">
              {rx.lines.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span className="font-medium">{l.drugName}</span>
                  <span className="text-muted-foreground">
                    {[l.dose, l.frequency, l.days ? `${l.days} days` : null].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BillsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['portal', 'bills', patientId],
    queryFn: () => patientApi.portal.bills({ patientId: patientId || undefined }),
  });
  // Razorpay stub: create the order, then "complete checkout" with the stub signature.
  const pay = useMutation({
    mutationFn: async (invoiceId: string) => {
      const intent = await patientApi.portal.createPaymentIntent({ invoiceId });
      return patientApi.portal.confirmPayment(intent.id, { providerPaymentId: `pay_stub_${Date.now()}`, signature: 'stub' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'bills'] }),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data.length) return <Empty>Your hospital bills will appear here.</Empty>;
  return (
    <div className="space-y-3">
      {pay.error && <p className="text-sm text-destructive">{errorMessage(pay.error)}</p>}
      {data.map((b) => (
        <Card key={b.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{b.number ?? 'Bill'}</p>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(b.issuedAt)} · {b.patientName}
              </p>
            </div>
            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="font-semibold">{rupees(b.total)}</p>
                {Number(b.due) > 0 && b.status !== 'cancelled' && <p className="text-xs text-destructive">Due {rupees(b.due)}</p>}
              </div>
              <StatusBadge status={b.status} />
              {Number(b.due) > 0 && b.status !== 'cancelled' && (
                <Button size="sm" onClick={() => pay.mutate(b.invoiceId)} disabled={pay.isPending}>
                  {pay.isPending && pay.variables === b.invoiceId && <Loader2 className="animate-spin" />} Pay {rupees(b.due)}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">Online payment is in test mode. No money is charged.</p>
    </div>
  );
}

export function ReportsTab({ patientId }: { patientId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['portal', 'reports', patientId],
    queryFn: () => patientApi.portal.reports({ patientId: patientId || undefined }),
  });
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data.length) return <Empty>Lab and scan reports will appear here once the hospital releases them.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <FileText className="size-5 text-primary" />
              <div>
                <p className="font-medium">{r.title}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(r.issuedAt)} · {r.patientName}
                </p>
              </div>
            </div>
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                Open
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
