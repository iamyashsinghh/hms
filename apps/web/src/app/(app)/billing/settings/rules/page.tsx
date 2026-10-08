'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { validate, type FieldErrors } from '@/lib/validate';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { SettingsTabs } from '@/modules/billing/tabs';
import { ErrorBox, formatDateTime } from '@/modules/billing/ui';

type RuleKey = keyof B.BillingRules;
/** Rules picked from a fixed list of options. */
type ChoiceKey = Exclude<RuleKey, 'registrationFee' | 'checkoutTime' | 'maxDiscountPct'>;

/** The form keeps typed numbers as text until they are checked. */
type Form = Omit<B.BillingRules, 'registrationFee' | 'maxDiscountPct'> & {
  registrationFee: { enabled: boolean; amount: string; validityMonths: string };
  maxDiscountPct: string;
};

const CHOICES: Record<ChoiceKey, { label: string; help?: string; options: { value: string; label: string; help?: string }[] }> = {
  opdPayment: {
    label: 'OPD consultation payment',
    options: [
      { value: 'before', label: 'Collect at check-in', help: 'Before the doctor sees the patient' },
      { value: 'after', label: 'Collect at the end of the visit', help: 'Everything on one bill when the patient leaves' },
    ],
  },
  opdUnpaid: {
    label: 'If the OPD consultation is unpaid',
    options: [
      { value: 'flag', label: 'Only show "unpaid"', help: "Flag in the doctor's queue" },
      { value: 'block', label: 'Keep out of the queue until paid' },
    ],
  },
  followUp: {
    label: 'Follow-up visits',
    options: [
      { value: 'doctor_fee', label: "Use each doctor's follow-up fee and days", help: 'Set on the doctor in Setup' },
      { value: 'full_fee', label: 'Always charge the full fee' },
    ],
  },
  labChargeAt: {
    label: "Lab tests from doctor's orders",
    options: [
      { value: 'order', label: 'Charge when the doctor orders' },
      { value: 'collection', label: 'Charge when the sample is collected' },
    ],
  },
  radiologyChargeAt: {
    label: "Radiology from doctor's orders",
    options: [
      { value: 'order', label: 'Charge when the doctor orders' },
      { value: 'scan_done', label: 'Charge when the scan is done' },
    ],
  },
  diagnosticsPayment: {
    label: 'Lab and radiology for OPD patients',
    options: [
      { value: 'before', label: 'Patient pays before the sample or scan', help: 'Unpaid orders are flagged on the worklist' },
      { value: 'after', label: 'Sample or scan first, pay later' },
    ],
  },
  ipdPharmacy: {
    label: 'Medicines for admitted patients',
    options: [
      { value: 'ipd_bill', label: 'Add to the IPD bill' },
      { value: 'separate', label: 'A separate pharmacy bill for each issue' },
    ],
  },
  roomRentDay: {
    label: 'Room rent day',
    options: [
      { value: 'midnight', label: 'Midnight to midnight' },
      { value: 'admission_time', label: '24 hours from admission time' },
      { value: 'checkout_time', label: 'Day turns at a check-out time' },
    ],
  },
  consumables: {
    label: 'Consumables issued to a patient',
    options: [
      { value: 'charge', label: 'Charge the patient' },
      { value: 'hospital_cost', label: 'Treat as hospital cost' },
    ],
  },
};

const SECTIONS: { title: string; rules: RuleKey[] }[] = [
  { title: 'OPD', rules: ['opdPayment', 'opdUnpaid', 'followUp', 'registrationFee'] },
  { title: 'Lab and radiology', rules: ['labChargeAt', 'radiologyChargeAt', 'diagnosticsPayment'] },
  { title: 'Admitted patients', rules: ['ipdPharmacy', 'roomRentDay', 'consumables'] },
  { title: 'Discounts and prices', rules: ['maxDiscountPct'] },
];

const PRESETS: { key: B.BillingRulePreset; label: string; help: string }[] = [
  { key: 'hospital', label: 'Hospital with IPD', help: 'The starting values for a hospital' },
  { key: 'clinic', label: 'Clinic, OPD only', help: 'Pay at check-in, medicines billed separately' },
];

const toForm = (r: B.BillingRules): Form => ({
  ...r,
  registrationFee: {
    enabled: r.registrationFee.enabled,
    amount: String(r.registrationFee.amount),
    validityMonths: r.registrationFee.validityMonths == null ? '' : String(r.registrationFee.validityMonths),
  },
  maxDiscountPct: String(r.maxDiscountPct),
});

const fromForm = (f: Form) => ({
  ...f,
  registrationFee: {
    enabled: f.registrationFee.enabled,
    amount: f.registrationFee.amount.trim() === '' ? 0 : f.registrationFee.amount,
    validityMonths: f.registrationFee.validityMonths.trim() === '' ? null : f.registrationFee.validityMonths,
  },
  maxDiscountPct: f.maxDiscountPct.trim() === '' ? 0 : f.maxDiscountPct,
});

/** checkoutTime goes with the room rent day: a branch overrides both together. */
const keysOf = (k: RuleKey): RuleKey[] => (k === 'roomRentDay' || k === 'checkoutTime' ? ['roomRentDay', 'checkoutTime'] : [k]);

export default function BillingRulesPage() {
  const canRead = usePermission('billing.service.read');
  const canManage = usePermission('billing.settings.manage');
  const { user } = useAuth();
  const facilities = user?.facilities ?? [];
  const [facilityId, setFacilityId] = React.useState('');
  // Kept here: the form remounts with the saved rules.
  const [saved, setSaved] = React.useState<string | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['billing', 'rules', facilityId || 'hospital'],
    queryFn: () => api.billing.rules.get(facilityId || undefined),
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Billing settings"
        description="How this hospital bills. Every department follows these rules when it posts a charge. Changes apply from now on; charges already posted keep the rule they were posted under."
      />
      <SettingsTabs />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <label htmlFor="rules-level" className="text-sm font-medium">
            Rules for
          </label>
          <Select id="rules-level" className="w-72" value={facilityId} onChange={(e) => {
              setFacilityId(e.target.value);
              setSaved(null);
            }}>
            <option value="">The whole hospital (all branches)</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                Branch: {f.name}
              </option>
            ))}
          </Select>
          <span className="text-sm text-muted-foreground">
            {facilityId ? 'A branch follows the hospital unless you change a rule here.' : 'Branches follow these unless they override a rule.'}
          </span>
        </CardContent>
      </Card>
      {error && <ErrorBox error={errorMessage(error)} />}
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && <RulesForm key={`${facilityId}:${data.updatedAt}`} view={data} facilityId={facilityId || undefined} readOnly={!canManage} saved={saved} onSaved={setSaved} />}
    </div>
  );
}

function RulesForm({
  view,
  facilityId,
  readOnly,
  saved,
  onSaved,
}: {
  view: B.BillingRulesView;
  facilityId?: string;
  readOnly: boolean;
  saved: string | null;
  onSaved: (notice: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const isBranch = !!facilityId;
  // What the branch falls back to: defaults ← hospital.
  const hospitalRules = React.useMemo(() => ({ ...B.DEFAULT_BILLING_RULES, ...view.hospital }) as B.BillingRules, [view]);
  const initial = React.useMemo(() => toForm(view.effective), [view]);
  const [form, setForm] = React.useState<Form>(initial);
  const [overridden, setOverridden] = React.useState<Set<RuleKey>>(() => new Set(Object.keys(view.branch ?? {}) as RuleKey[]));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [localNotice, setNotice] = React.useState<string | null>(null);
  const notice = localNotice ?? saved;

  const save = useMutation({
    mutationFn: (body: B.BillingRulesInput) => api.billing.rules.save(body),
    onSuccess: (next) => {
      queryClient.setQueryData(['billing', 'rules', facilityId ?? 'hospital'], next);
      queryClient.invalidateQueries({ queryKey: ['billing', 'rules'] });
      onSaved('Saved. New charges follow these rules from now.');
    },
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setNotice(null);
    onSaved(null);
    setForm((f) => ({ ...f, [key]: value }));
    if (isBranch) setOverridden((o) => new Set([...o, ...keysOf(key as RuleKey)]));
  };
  const followHospital = (key: RuleKey) => {
    const back = toForm(hospitalRules);
    setForm((f) => {
      const next = { ...f };
      for (const k of keysOf(key)) (next as Record<string, unknown>)[k] = back[k];
      return next;
    });
    setOverridden((o) => {
      const next = new Set(o);
      for (const k of keysOf(key)) next.delete(k);
      return next;
    });
  };
  const applyPreset = (key: B.BillingRulePreset) => {
    setForm(toForm(B.BILLING_RULE_PRESETS[key]));
    if (isBranch) setOverridden(new Set(Object.keys(B.DEFAULT_BILLING_RULES) as RuleKey[]));
    setNotice(`"${PRESETS.find((p) => p.key === key)!.label}" filled in. Check the rules and save.`);
  };

  const dirty =
    JSON.stringify(fromForm(form)) !== JSON.stringify(fromForm(initial)) || (isBranch && [...overridden].sort().join() !== Object.keys(view.branch ?? {}).sort().join());

  const submit = () => {
    setNotice(null);
    const r = validate(B.billingRulesSchema, fromForm(form));
    setErrors(r.errors ?? {});
    if (!r.data) return;
    const rules = isBranch ? Object.fromEntries([...overridden].map((k) => [k, r.data[k]])) : r.data;
    save.mutate({ facilityId, replace: true, rules });
  };
  const resetBranch = () => {
    if (!confirm('Make this branch follow every hospital rule again?')) return;
    setNotice(null);
    save.mutate({ facilityId, replace: true, rules: {} });
  };

  const row = (key: RuleKey) => {
    const isOver = overridden.has(key);
    const meta = (
      <RuleMeta isBranch={isBranch} overridden={isOver} readOnly={readOnly} onUseHospital={() => followHospital(key)} />
    );
    if (key === 'registrationFee') {
      const rf = form.registrationFee;
      return (
        <RuleRow key={key} label="Registration fee" help="Charged when a new patient is registered, and again when the registration runs out." meta={meta} overridden={isBranch && isOver}>
          <Options
            name={key}
            value={rf.enabled ? 'on' : 'off'}
            disabled={readOnly}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            onChange={(v) => set('registrationFee', { ...rf, enabled: v === 'on' })}
          />
          {rf.enabled && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Amount (₹)
                <Input
                  className="mt-1 w-32"
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={readOnly}
                  value={rf.amount}
                  aria-invalid={!!errors['registrationFee.amount']}
                  onChange={(e) => set('registrationFee', { ...rf, amount: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Valid for (months)
                <Input
                  className="mt-1 w-32"
                  type="number"
                  min={1}
                  max={120}
                  placeholder="Never again"
                  disabled={readOnly}
                  value={rf.validityMonths}
                  aria-invalid={!!errors['registrationFee.validityMonths']}
                  onChange={(e) => set('registrationFee', { ...rf, validityMonths: e.target.value })}
                />
              </label>
              <span className="pb-2 text-xs text-muted-foreground">Leave months blank to charge only once.</span>
            </div>
          )}
          <FieldErr errors={errors} keys={['registrationFee.amount', 'registrationFee.validityMonths']} />
        </RuleRow>
      );
    }
    if (key === 'maxDiscountPct') {
      return (
        <React.Fragment key={key}>
          <RuleRow
            label="Discount limit"
            help={'Most discount, as % of the bill, a cashier can give. Staff with the "override discount" permission (for example the billing manager) can give any discount.'}
            meta={meta}
            overridden={isBranch && isOver}
          >
            <div className="flex items-center gap-2">
              <Input
                className="w-24"
                type="number"
                min={0}
                max={100}
                step="0.5"
                aria-label="Discount limit %"
                disabled={readOnly}
                value={form.maxDiscountPct}
                aria-invalid={!!errors.maxDiscountPct}
                onChange={(e) => set('maxDiscountPct', e.target.value)}
              />
              <span className="text-sm text-muted-foreground">% of the bill</span>
            </div>
            <FieldErr errors={errors} keys={['maxDiscountPct']} />
          </RuleRow>
          <RuleRow label="Price override" help="Who can change the price on a charge or bill line." overridden={false}>
            <p className="text-sm">
              Staff with the <span className="font-medium">&quot;override prices&quot;</span> permission (the billing manager by default). Change it under Roles in Setup.
            </p>
          </RuleRow>
        </React.Fragment>
      );
    }
    if (key === 'checkoutTime') return null;
    const c = CHOICES[key as ChoiceKey];
    return (
      <RuleRow key={key} label={c.label} help={c.help} meta={meta} overridden={isBranch && isOver}>
        <Options name={key} value={form[key as ChoiceKey]} options={c.options} disabled={readOnly} onChange={(v) => set(key as ChoiceKey, v as never)} />
        {key === 'roomRentDay' && form.roomRentDay === 'checkout_time' && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            Day turns at
            <Input className="w-28" type="time" disabled={readOnly} value={form.checkoutTime} aria-invalid={!!errors.checkoutTime} onChange={(e) => set('checkoutTime', e.target.value)} />
          </label>
        )}
        {key === 'roomRentDay' && <FieldErr errors={errors} keys={['checkoutTime']} />}
      </RuleRow>
    );
  };

  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="text-sm font-medium">Start from a preset</span>
            {PRESETS.map((p) => (
              <Button key={p.key} variant="outline" size="sm" title={p.help} onClick={() => applyPreset(p.key)}>
                {p.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">Fills in every rule; nothing is saved until you press Save.</span>
          </CardContent>
        </Card>
      )}

      {SECTIONS.map((s) => (
        <Card key={s.title}>
          <CardHeader className="pb-2">
            <CardTitle>{s.title}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">{s.rules.map(row)}</CardContent>
        </Card>
      ))}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 rounded-md border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        {!readOnly && (
          <Button disabled={save.isPending || !dirty} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save {isBranch ? 'branch rules' : 'hospital rules'}
          </Button>
        )}
        {!readOnly && isBranch && Object.keys(view.branch ?? {}).length > 0 && (
          <Button variant="outline" disabled={save.isPending} onClick={resetBranch}>
            <RotateCcw /> Reset branch to hospital
          </Button>
        )}
        {readOnly && <span className="text-sm text-muted-foreground">You can view these rules. Ask an administrator to change them.</span>}
        <span className="ml-auto text-xs text-muted-foreground">{view.updatedAt ? `Last updated ${formatDateTime(view.updatedAt)}` : 'Not changed yet: starting values'}</span>
        <div className="w-full empty:hidden">
          <ErrorBox error={save.error ? errorMessage(save.error) : Object.keys(errors).length ? 'Check the highlighted rules.' : null} />
          {notice && <p className="text-sm text-primary">{notice}</p>}
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, help, meta, overridden, children }: { label: string; help?: string; meta?: React.ReactNode; overridden: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-3 px-6 py-4 sm:grid-cols-5', overridden && 'bg-primary/5')}>
      <div className="sm:col-span-2">
        <div className="text-sm font-medium">{label}</div>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
        {meta}
      </div>
      <div className="sm:col-span-3">{children}</div>
    </div>
  );
}

function RuleMeta({ isBranch, overridden, readOnly, onUseHospital }: { isBranch: boolean; overridden: boolean; readOnly: boolean; onUseHospital: () => void }) {
  if (!isBranch) return null;
  if (!overridden)
    return (
      <Badge variant="secondary" className="mt-1.5">
        Same as hospital
      </Badge>
    );
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Badge variant="default">This branch</Badge>
      {!readOnly && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={onUseHospital}>
          Use hospital value
        </button>
      )}
    </div>
  );
}

function Options({
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; help?: string }[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm',
            value === o.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
            disabled && 'cursor-default opacity-80',
          )}
        >
          <input type="radio" className="mt-0.5" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.help && <span className="block text-xs text-muted-foreground">{o.help}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function FieldErr({ errors, keys }: { errors: FieldErrors; keys: string[] }) {
  const msg = keys.map((k) => errors[k]).find(Boolean);
  return msg ? <p className="mt-1 text-xs text-destructive">{msg}</p> : null;
}
