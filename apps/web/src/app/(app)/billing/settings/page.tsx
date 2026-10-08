'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field } from '@/modules/billing/ui';

type Form = Record<Exclude<keyof B.BillingSettings, 'roundOff'>, string> & { roundOff: boolean };

const FIELDS: { key: Exclude<keyof Form, 'roundOff'>; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: 'legalName', label: 'Name on bills', placeholder: 'e.g. Sharma Multispeciality Hospital Pvt Ltd', wide: true },
  { key: 'gstin', label: 'GSTIN', placeholder: '15 characters' },
  { key: 'stateCode', label: 'GST state code', placeholder: 'e.g. 27' },
  { key: 'address', label: 'Address on bills', wide: true },
  { key: 'phone', label: 'Phone' },
  { key: 'upiVpa', label: 'UPI ID for QR on bills', placeholder: 'hospital@okhdfc' },
  { key: 'upiPayeeName', label: 'UPI payee name' },
  { key: 'invoiceFooter', label: 'Footer text', placeholder: 'Terms, thank-you note…', wide: true },
];

export default function BillingSettingsPage() {
  const canManage = usePermission('billing.settings.manage');
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['billing', 'settings'], queryFn: () => api.billing.settings.get(), enabled: canManage });

  if (!canManage) return <NoAccess />;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Billing settings" description="What prints on every bill, and the UPI ID used for the pay-by-QR code." />
      {error && <ErrorBox error={errorMessage(error)} />}
      {data && <SettingsForm initial={data} onSaved={(next) => queryClient.setQueryData(['billing', 'settings'], next)} />}
    </div>
  );
}

function SettingsForm({ initial, onSaved }: { initial: B.BillingSettings; onSaved: (s: B.BillingSettings) => void }) {
  const [form, setForm] = React.useState<Form>(() => ({
    ...(Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] ?? ''])) as unknown as Form),
    roundOff: initial.roundOff,
  }));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: B.BillingSettingsInput) => api.billing.settings.update(body),
    onSuccess: onSaved,
  });

  return (
    <>
      {(
        <Card>
          <CardContent className="pt-6">
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const r = validate(B.billingSettingsInputSchema, { ...form, gstin: form.gstin.trim().toUpperCase() });
                setErrors(r.errors ?? {});
                if (r.data) save.mutate(r.data);
              }}
            >
              <div className="sm:col-span-2">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
                {save.isSuccess && <p className="text-sm text-primary">Saved.</p>}
              </div>
              {FIELDS.map((f) => (
                <Field key={f.key} id={f.key} label={f.label} className={f.wide ? 'sm:col-span-2' : undefined} error={errors[f.key]}>
                  <Input id={f.key} placeholder={f.placeholder} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                </Field>
              ))}
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={form.roundOff} onChange={(e) => setForm({ ...form, roundOff: e.target.checked })} /> Round bill totals to the nearest rupee
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save settings
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
