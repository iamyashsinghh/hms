'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, formatINR, todayIST } from '@/modules/insurance/ui';

/** Claim statuses the API lets you edit (PATCH /insurance/claims/:id); bill shares only while draft. */
export const CLAIM_CLOSED: I.ClaimStatus[] = ['settled', 'rejected', 'cancelled'];

/** Edit a claim's admission/discharge dates, diagnosis and notes; payer shares on its bills while it is a draft. */
export function ClaimEditForm({ claim, onDone, onCancel }: { claim: I.Claim; onDone: (c: I.Claim) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const draft = claim.status === 'draft';
  const [v, setV] = React.useState({
    admissionDate: claim.admissionDate ?? '',
    dischargeDate: claim.dischargeDate ?? '',
    diagnosis: claim.diagnosis ?? '',
    notes: claim.notes ?? '',
  });
  const [shares, setShares] = React.useState<Record<string, string>>(() => Object.fromEntries(claim.invoices.map((b) => [b.invoiceId, String(b.payerAmount)])));
  const [formError, setFormError] = React.useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (body: I.UpdateClaim) => api.insurance.claims.update(claim.id, body),
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['insurance'], refetchType: 'none' });
      onDone(next);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const body: I.UpdateClaim = {
      admissionDate: v.admissionDate || null,
      dischargeDate: v.dischargeDate || null,
      diagnosis: v.diagnosis.trim() || null,
      notes: v.notes.trim() || null,
    };
    if (body.admissionDate && body.dischargeDate && body.dischargeDate < body.admissionDate) return setFormError('Discharge date is before the admission date');
    if (body.admissionDate && body.admissionDate > todayIST()) return setFormError('Admission date cannot be in the future');
    if (draft && claim.invoices.length) {
      const list = claim.invoices.map((b) => ({ invoiceId: b.invoiceId, payerAmount: Number(shares[b.invoiceId]) }));
      const bad = claim.invoices.find((b) => shares[b.invoiceId]?.trim() === '' || !(Number(shares[b.invoiceId]) >= 0));
      if (bad) return setFormError(`Payer share on ${bad.invoiceNumber} must be zero or more`);
      const over = claim.invoices.find((b) => Number(shares[b.invoiceId]) > b.invoiceTotal);
      if (over) return setFormError(`Payer share on ${over.invoiceNumber} is more than the bill total`);
      if (list.every((l) => l.payerAmount === 0)) return setFormError('The payer share comes to ₹0');
      body.invoices = list;
    }
    const parsed = I.updateClaimSchema.safeParse(body);
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Check the form');
    save.mutate(body);
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cl-adm" label="Admission date">
          <Input id="cl-adm" type="date" max={todayIST()} value={v.admissionDate} onChange={set('admissionDate')} />
        </Field>
        <Field id="cl-dis" label="Discharge date">
          <Input id="cl-dis" type="date" min={v.admissionDate || undefined} value={v.dischargeDate} onChange={set('dischargeDate')} />
        </Field>
        <Field id="cl-diag" label="Final diagnosis" className="sm:col-span-2">
          <Input id="cl-diag" maxLength={1000} value={v.diagnosis} onChange={set('diagnosis')} />
        </Field>
        <Field id="cl-notes" label="Notes" className="sm:col-span-2">
          <Input id="cl-notes" maxLength={1000} value={v.notes} onChange={set('notes')} />
        </Field>
      </div>
      {draft && claim.invoices.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Bill</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-44">Payer share (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claim.invoices.map((b) => (
                <TableRow key={b.invoiceId}>
                  <TableCell className="font-mono text-xs">{b.invoiceNumber}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(b.invoiceTotal)}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      max={b.invoiceTotal}
                      step="0.01"
                      aria-label={`Payer share on ${b.invoiceNumber}`}
                      value={shares[b.invoiceId] ?? ''}
                      onChange={(e) => setShares((s) => ({ ...s, [b.invoiceId]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
