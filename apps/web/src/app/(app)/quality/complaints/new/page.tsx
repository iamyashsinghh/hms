'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EnumSelect, ErrorBox, Field, PatientPicker, Textarea } from '@/modules/quality/ui';

export default function NewComplaintPage() {
  const can = usePermission('quality.complaint.create');
  const canRead = usePermission('quality.complaint.read');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [source, setSource] = React.useState<Q.ComplaintSource | ''>('walk_in');
  const [category, setCategory] = React.useState<Q.ComplaintCategory | ''>('');
  const [priority, setPriority] = React.useState<Q.ComplaintPriority | ''>('medium');
  const [patient, setPatient] = React.useState<Q.PatientRef | null>(null);
  const [name, setName] = React.useState('');
  const [mobile, setMobile] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [saved, setSaved] = React.useState<Q.Complaint | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const create = useMutation({
    mutationFn: (body: Q.CreateComplaint) => api.quality.complaints.create(body),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      if (canRead) router.push(`/quality/complaints/${c.id}`);
      else setSaved(c);
    },
  });

  if (!can) return <NoAccess />;
  if (saved) {
    return (
      <Card className="mx-auto mt-8 max-w-md">
        <CardContent className="space-y-3 pt-6 text-center">
          <h2 className="text-lg font-semibold">Complaint {saved.complaintNo} registered</h2>
          <p className="text-sm text-muted-foreground">Give this number to the complainant. The quality team will respond by {new Date(saved.dueAt).toLocaleString('en-IN')}.</p>
          <Button variant="outline" onClick={() => setSaved(null)}>
            Register another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Register a complaint" />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Q.CreateComplaint = {
            source: source as Q.ComplaintSource,
            category: category as Q.ComplaintCategory,
            priority: priority as Q.ComplaintPriority,
            patientId: patient?.id,
            complainantName: name,
            complainantMobile: mobile || undefined,
            department: department || undefined,
            description,
          };
          const { errors: found } = validate(Q.createComplaintSchema, body);
          setErrors(found ?? {});
          if (!found) create.mutate(body);
        }}
      >
        <ErrorBox error={Object.keys(errors).length ? 'Please correct the highlighted fields' : create.error} />
        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            <Field id="name" label="Complainant name *" error={errors.complainantName}>
              <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="mobile" label="Mobile" error={errors.complainantMobile}>
              <Input id="mobile" inputMode="tel" maxLength={14} placeholder="10-digit mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Field>
            <Field id="patient" label="Patient (if any)" className="sm:col-span-2">
              <PatientPicker
                value={patient}
                onChange={(p) => {
                  setPatient(p);
                  if (p && !name) setName(p.name);
                }}
              />
            </Field>
            <Field id="source" label="Received via *">
              <EnumSelect id="source" value={source} onChange={setSource} options={Q.COMPLAINT_SOURCES} />
            </Field>
            <Field id="category" label="About *" error={errors.category}>
              <EnumSelect id="category" value={category} onChange={setCategory} options={Q.COMPLAINT_CATEGORIES} placeholder="Choose…" />
            </Field>
            <Field id="priority" label="Priority">
              <EnumSelect id="priority" value={priority} onChange={setPriority} options={Q.COMPLAINT_PRIORITIES} />
            </Field>
            <Field id="department" label="Department">
              <Input id="department" maxLength={120} value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
            <Field id="description" label="Complaint *" className="sm:col-span-2" error={errors.description}>
              <Textarea id="description" rows={5} required maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
        <Button type="submit" disabled={create.isPending || !category}>
          {create.isPending && <Loader2 className="animate-spin" />} Register complaint
        </Button>
      </form>
    </div>
  );
}
