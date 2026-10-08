'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { validate, type FieldErrors } from '@/lib/validate';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, PAYER_TYPE_LABELS, SCHEME_LABELS, opt, optNum } from './ui';

type Values = Record<string, string | boolean>;

const fromPayer = (p?: I.Payer): Values => ({
  code: p?.code ?? '',
  name: p?.name ?? '',
  type: p?.type ?? 'insurer',
  scheme: p?.scheme ?? '',
  contactName: p?.contactName ?? '',
  phone: p?.phone ?? '',
  email: p?.email ?? '',
  address: p?.address ?? '',
  gstin: p?.gstin ?? '',
  portalUrl: p?.portalUrl ?? '',
  creditDays: String(p?.creditDays ?? 30),
  tdsPercent: String(p?.tdsPercent ?? 10),
  copayPercent: String(p?.copayPercent ?? 0),
  creditLimit: p?.creditLimit != null ? String(p.creditLimit) : '',
  preauthRequired: p?.preauthRequired ?? true,
  notes: p?.notes ?? '',
  isActive: p?.isActive ?? true,
});

/** Create / edit form for an insurer, TPA, corporate or government scheme. */
export function PayerForm({ payer, onSubmit, pending, error }: { payer?: I.Payer; onSubmit: (body: I.PayerInput) => void; pending: boolean; error: string | null }) {
  const [v, setV] = React.useState<Values>(() => fromPayer(payer));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const s = (k: string) => String(v[k] ?? '');
  const [errors, setErrors] = React.useState<FieldErrors>({});

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body: I.PayerInput = {
          code: s('code'),
          name: s('name'),
          type: s('type') as I.PayerType,
          scheme: s('type') === 'government' ? ((opt(s('scheme')) as I.Scheme) ?? null) : null,
          contactName: opt(s('contactName')) ?? null,
          phone: opt(s('phone')) ?? null,
          email: s('email').trim(),
          address: opt(s('address')) ?? null,
          gstin: s('gstin').trim(),
          portalUrl: s('portalUrl').trim(),
          creditDays: s('creditDays').trim() === '' ? 30 : Number(s('creditDays')),
          tdsPercent: s('tdsPercent').trim() === '' ? 0 : Number(s('tdsPercent')),
          copayPercent: s('copayPercent').trim() === '' ? 0 : Number(s('copayPercent')),
          creditLimit: optNum(s('creditLimit')) ?? null,
          preauthRequired: !!v.preauthRequired,
          notes: opt(s('notes')) ?? null,
          isActive: !!v.isActive,
        };
        // Same rules as the server (code is fixed on edit), shown on the fields.
        const r = validate(I.payerInputSchema, payer ? { ...body, code: payer.code } : body);
        setErrors(r.errors ?? {});
        if (r.data) onSubmit(body);
      }}
    >
      <Field id="code" error={errors.code} label="Code">
        <Input id="code" required value={s('code')} onChange={set('code')} disabled={!!payer} placeholder="STAR" />
      </Field>
      <Field id="name" error={errors.name} label="Name" className="sm:col-span-2">
        <Input id="name" required value={s('name')} onChange={set('name')} placeholder="Star Health and Allied Insurance" />
      </Field>
      <Field id="type" label="Type">
        <Select id="type" value={s('type')} onChange={set('type')}>
          {I.PAYER_TYPES.map((t) => (
            <option key={t} value={t}>
              {PAYER_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      {s('type') === 'government' && (
        <Field id="scheme" error={errors.scheme} label="Scheme">
          <Select id="scheme" required value={s('scheme')} onChange={set('scheme')}>
            <option value="">Choose…</option>
            {I.SCHEMES.map((t) => (
              <option key={t} value={t}>
                {SCHEME_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field id="creditDays" error={errors.creditDays} label="Credit period (days)">
        <Input id="creditDays" type="number" min={0} max={365} value={s('creditDays')} onChange={set('creditDays')} />
      </Field>
      <Field id="tds" error={errors.tdsPercent} label="TDS %">
        <Input id="tds" type="number" step="0.01" min={0} max={100} value={s('tdsPercent')} onChange={set('tdsPercent')} />
      </Field>
      <Field id="copay" error={errors.copayPercent} label="Default co-pay %">
        <Input id="copay" type="number" step="0.01" min={0} max={100} value={s('copayPercent')} onChange={set('copayPercent')} />
      </Field>
      <Field id="creditLimit" error={errors.creditLimit} label="Credit limit (₹, corporates)">
        <Input id="creditLimit" type="number" step="0.01" min={0} value={s('creditLimit')} onChange={set('creditLimit')} />
      </Field>
      <Field id="contact" error={errors.contactName} label="Contact person">
        <Input id="contact" value={s('contactName')} onChange={set('contactName')} />
      </Field>
      <Field id="phone" error={errors.phone} label="Phone">
        <Input id="phone" value={s('phone')} onChange={set('phone')} />
      </Field>
      <Field id="email" error={errors.email} label="Email">
        <Input id="email" type="email" value={s('email')} onChange={set('email')} />
      </Field>
      <Field id="gstin" error={errors.gstin} label="GSTIN">
        <Input id="gstin" value={s('gstin')} onChange={set('gstin')} />
      </Field>
      <Field id="portal" error={errors.portalUrl} label="Claims portal URL" className="sm:col-span-2">
        <Input id="portal" type="url" value={s('portalUrl')} onChange={set('portalUrl')} placeholder="https://" />
      </Field>
      <Field id="address" error={errors.address} label="Address" className="sm:col-span-2">
        <Input id="address" value={s('address')} onChange={set('address')} />
      </Field>
      <Field id="notes" error={errors.notes} label="Notes" className="sm:col-span-2 lg:col-span-4">
        <Input id="notes" value={s('notes')} onChange={set('notes')} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!v.preauthRequired} onChange={(e) => setV((x) => ({ ...x, preauthRequired: e.target.checked }))} /> Pre-auth needed for admissions
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!v.isActive} onChange={(e) => setV((x) => ({ ...x, isActive: e.target.checked }))} /> Active
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-4">
        <div className="flex-1">
          <ErrorBox error={error} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {payer ? 'Save payer' : 'Add payer'}
        </Button>
      </div>
    </form>
  );
}
