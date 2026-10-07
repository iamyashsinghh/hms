'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { insurance as I } from '@hms/shared';
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

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
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
          creditDays: Number(s('creditDays') || 30),
          tdsPercent: Number(s('tdsPercent') || 0),
          copayPercent: Number(s('copayPercent') || 0),
          creditLimit: optNum(s('creditLimit')) ?? null,
          preauthRequired: !!v.preauthRequired,
          notes: opt(s('notes')) ?? null,
          isActive: !!v.isActive,
        });
      }}
    >
      <Field id="code" label="Code">
        <Input id="code" required value={s('code')} onChange={set('code')} disabled={!!payer} placeholder="STAR" />
      </Field>
      <Field id="name" label="Name" className="sm:col-span-2">
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
        <Field id="scheme" label="Scheme">
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
      <Field id="creditDays" label="Credit period (days)">
        <Input id="creditDays" type="number" min={0} max={365} value={s('creditDays')} onChange={set('creditDays')} />
      </Field>
      <Field id="tds" label="TDS %">
        <Input id="tds" type="number" step="0.01" min={0} max={100} value={s('tdsPercent')} onChange={set('tdsPercent')} />
      </Field>
      <Field id="copay" label="Default co-pay %">
        <Input id="copay" type="number" step="0.01" min={0} max={100} value={s('copayPercent')} onChange={set('copayPercent')} />
      </Field>
      <Field id="creditLimit" label="Credit limit (₹, corporates)">
        <Input id="creditLimit" type="number" step="0.01" min={0} value={s('creditLimit')} onChange={set('creditLimit')} />
      </Field>
      <Field id="contact" label="Contact person">
        <Input id="contact" value={s('contactName')} onChange={set('contactName')} />
      </Field>
      <Field id="phone" label="Phone">
        <Input id="phone" value={s('phone')} onChange={set('phone')} />
      </Field>
      <Field id="email" label="Email">
        <Input id="email" type="email" value={s('email')} onChange={set('email')} />
      </Field>
      <Field id="gstin" label="GSTIN">
        <Input id="gstin" value={s('gstin')} onChange={set('gstin')} />
      </Field>
      <Field id="portal" label="Claims portal URL" className="sm:col-span-2">
        <Input id="portal" type="url" value={s('portalUrl')} onChange={set('portalUrl')} placeholder="https://" />
      </Field>
      <Field id="address" label="Address" className="sm:col-span-2">
        <Input id="address" value={s('address')} onChange={set('address')} />
      </Field>
      <Field id="notes" label="Notes" className="sm:col-span-2 lg:col-span-4">
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
