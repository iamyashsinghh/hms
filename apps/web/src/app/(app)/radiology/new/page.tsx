'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { radiology, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { ageOf, fullName, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea, rupees } from '@/modules/radiology/ui';

function PatientPicker({ onPick }: { onPick: (p: Patient) => void }) {
  const [q, setQ] = React.useState('');
  const term = q.trim();
  const results = useQuery({
    queryKey: ['patients', { q: term, page: 1 }],
    queryFn: () => api.patients.list({ q: term, page: 1, pageSize: 8 }),
    enabled: term.length >= 2,
  });
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus placeholder="Search by name, UHID or mobile" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {results.data && (
        <ul className="mt-2 divide-y rounded-md border">
          {results.data.items.length === 0 && <li className="p-3 text-sm text-muted-foreground">No patient found. Register them first.</li>}
          {results.data.items.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full p-3 text-left text-sm hover:bg-muted/50" onClick={() => onPick(p)}>
                <span className="font-medium">{fullName(p)}</span>{' '}
                <span className="text-muted-foreground">
                  · {ageOf(p)} / {genderLabel(p.gender)} · {p.uhid} {p.mobile ? `· ${p.mobile}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewOrder() {
  const canCreate = usePermission('radiology.order.create');
  const router = useRouter();
  const params = useSearchParams();
  const initialPatientId = params.get('patientId') ?? '';
  const preset = useQuery({ queryKey: ['patients', initialPatientId], queryFn: () => api.patients.get(initialPatientId), enabled: canCreate && !!initialPatientId });
  const [picked, setPicked] = React.useState<Patient | null>(null);
  const patient = picked ?? preset.data ?? null;

  const tests = useQuery({ queryKey: ['radiology', 'tests'], queryFn: () => api.radiology.tests(), enabled: canCreate });
  const [testId, setTestId] = React.useState('');
  const [priority, setPriority] = React.useState<radiology.OrderPriority>('routine');
  const canListDoctors = usePermission('setup.doctor.read');
  const doctors = useQuery({ queryKey: ['setup', 'doctors'], queryFn: () => api.setup.listDoctors(), enabled: canCreate && canListDoctors });
  const [doctorId, setDoctorId] = React.useState('');
  const [referrer, setReferrer] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: radiology.CreateOrder) => api.radiology.createOrder(body),
    onSuccess: (o) => router.push(`/radiology/orders/${o.id}`),
  });

  if (!canCreate) return <NoAccess />;

  const byModality = new Map<string, radiology.RadiologyTest[]>();
  for (const t of tests.data ?? []) byModality.set(t.modalityName, [...(byModality.get(t.modalityName) ?? []), t]);
  const test = tests.data?.find((t) => t.id === testId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return setProblem('Pick the patient');
    const parsed = radiology.createOrderSchema.safeParse({
      patientId: patient.id,
      testId,
      priority,
      referringDoctorId: doctorId || undefined,
      referringDoctorName: doctorId ? undefined : referrer || undefined,
      clinicalNotes: notes || undefined,
    });
    if (!parsed.success) return setProblem(testId ? (parsed.error.issues[0]?.message ?? 'Check the form') : 'Pick the test');
    setProblem(null);
    create.mutate(parsed.data);
  };

  return (
    <div className="max-w-2xl">
      <Link href="/radiology" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Worklist
      </Link>
      <PageHeader title="New radiology order" description="For walk-ins and outside referrals. Doctors' orders from OPD arrive on the worklist by themselves." />
      <Card>
        <CardContent className="pt-6">
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <Label>Patient</Label>
              <div className="mt-1.5">
                {patient ? (
                  <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span>
                      <b>{fullName(patient)}</b> · {ageOf(patient)} / {genderLabel(patient.gender)} · {patient.uhid}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)} disabled={!picked && !!preset.data}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <PatientPicker onPick={setPicked} />
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="test">Test</Label>
              <Select id="test" className="mt-1.5" value={testId} onChange={(e) => setTestId(e.target.value)}>
                <option value="">{tests.isPending ? 'Loading…' : 'Pick a test'}</option>
                {[...byModality.entries()].map(([modality, list]) => (
                  <optgroup key={modality} label={modality}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.price != null ? `(${rupees(t.price)})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {tests.data?.length === 0 && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  No tests yet. Add them in <Link href="/radiology/masters" className="underline">Radiology masters</Link>.
                </p>
              )}
              {test?.preparation && <p className="mt-1.5 text-sm text-amber-700">Preparation: {test.preparation}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select id="priority" className="mt-1.5" value={priority} onChange={(e) => setPriority(e.target.value as radiology.OrderPriority)}>
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT (emergency)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="ref">Referred by</Label>
                {doctors.data && doctors.data.length > 0 && (
                  <Select id="ref" className="mt-1.5" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">Outside doctor / self</option>
                    {doctors.data.map((d) => (
                      <option key={d.userId} value={d.userId}>
                        {d.name}
                        {d.specialization ? ` (${d.specialization})` : ''}
                      </option>
                    ))}
                  </Select>
                )}
                {!doctorId && (
                  <Input
                    id={doctors.data?.length ? 'ref-outside' : 'ref'}
                    className="mt-1.5"
                    placeholder="Outside doctor's name"
                    maxLength={120}
                    value={referrer}
                    onChange={(e) => setReferrer(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Clinical notes</Label>
              <Textarea id="notes" className="mt-1.5" rows={3} maxLength={1000} placeholder="Reason for the study, history" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {(problem || create.error) && <p className="text-sm text-destructive">{problem ?? errorMessage(create.error)}</p>}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create order
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewRadiologyOrderPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <NewOrder />
    </Suspense>
  );
}
