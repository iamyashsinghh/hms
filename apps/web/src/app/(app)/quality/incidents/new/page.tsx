'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CATEGORY_LABELS, EnumSelect, ErrorBox, Field, KIND_LABELS, PatientPicker, Textarea, localDateTime } from '@/modules/quality/ui';

export default function ReportIncidentPage() {
  const can = usePermission('quality.incident.report');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [kind, setKind] = React.useState<Q.IncidentKind | ''>('incident');
  const [category, setCategory] = React.useState<Q.IncidentCategory | ''>('');
  const [severity, setSeverity] = React.useState<Q.IncidentSeverity | ''>('no_harm');
  const [occurredAt, setOccurredAt] = React.useState(localDateTime());
  const [location, setLocation] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [patient, setPatient] = React.useState<Q.PatientRef | null>(null);
  const [description, setDescription] = React.useState('');
  const [immediateAction, setImmediateAction] = React.useState('');
  const [anonymous, setAnonymous] = React.useState(false);
  const [done, setDone] = React.useState<Q.Incident | null>(null);

  const report = useMutation({
    mutationFn: () =>
      api.quality.incidents.report({
        kind: kind as Q.IncidentKind,
        category: category as Q.IncidentCategory,
        severity: severity as Q.IncidentSeverity,
        occurredAt: new Date(occurredAt).toISOString(),
        location: location || undefined,
        department: department || undefined,
        patientId: patient?.id,
        description,
        immediateAction: immediateAction || undefined,
        anonymous,
      }),
    onSuccess: (inc) => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      if (anonymous) setDone(inc);
      else router.push(`/quality/incidents/${inc.id}`);
    },
  });

  if (!can) return <NoAccess />;
  if (done) {
    return (
      <Card className="mx-auto mt-8 max-w-md">
        <CardContent className="space-y-3 pt-6 text-center">
          <h2 className="text-lg font-semibold">Thank you. Report {done.incidentNo} was submitted anonymously.</h2>
          <p className="text-sm text-muted-foreground">Your name was not stored, so this report will not appear under My reports.</p>
          <Button variant="outline" onClick={() => router.push('/quality')}>
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Report an incident" description="Report incidents and near misses as soon as possible, ideally within 24 hours. This is about systems, not blame." />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          report.mutate();
        }}
      >
        <ErrorBox error={report.error} />
        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            <Field id="kind" label="Type *">
              <EnumSelect id="kind" value={kind} onChange={setKind} options={Q.INCIDENT_KINDS} labels={KIND_LABELS} />
            </Field>
            <Field id="category" label="Category *">
              <EnumSelect id="category" value={category} onChange={setCategory} options={Q.INCIDENT_CATEGORIES} labels={CATEGORY_LABELS} placeholder="Choose…" />
            </Field>
            <Field id="severity" label="Harm to patient / staff *">
              <EnumSelect id="severity" value={severity} onChange={setSeverity} options={Q.INCIDENT_SEVERITIES} />
            </Field>
            <Field id="occurredAt" label="When did it happen? *">
              <Input id="occurredAt" type="datetime-local" required max={localDateTime()} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </Field>
            <Field id="location" label="Where">
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ward 3, bed 12" />
            </Field>
            <Field id="department" label="Department">
              <Input id="department" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
            <Field id="patient" label="Patient involved (optional)" className="sm:col-span-2">
              <PatientPicker value={patient} onChange={setPatient} />
            </Field>
            <Field id="description" label="What happened? *" className="sm:col-span-2">
              <Textarea id="description" required rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field id="immediateAction" label="Immediate action taken" className="sm:col-span-2">
              <Textarea id="immediateAction" value={immediateAction} onChange={(e) => setImmediateAction(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span>
                Report anonymously
                <span className="block text-xs text-muted-foreground">Your name is not saved anywhere. You will not be able to follow this report.</span>
              </span>
            </label>
          </CardContent>
        </Card>
        <Button type="submit" disabled={report.isPending || !category}>
          {report.isPending && <Loader2 className="animate-spin" />} Submit report
        </Button>
      </form>
    </div>
  );
}
