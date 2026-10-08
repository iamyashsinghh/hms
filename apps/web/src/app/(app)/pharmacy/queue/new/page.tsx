'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { pharmacy, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ItemPicker } from '@/modules/pharmacy/item-picker';
import { PatientPicker } from '@/modules/pharmacy/patient-picker';

interface Line {
  key: number;
  drugName: string;
  itemId?: string;
  dose: string;
  frequency: string;
  days: string;
  qty: string;
}
let nextKey = 1;

export default function PaperPrescriptionPage() {
  const canCreate = usePermission('pharmacy.prescription.create');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [doctorName, setDoctorName] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const set = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const [errors, setErrors] = React.useState<FieldErrors | null>(null);
  const save = useMutation({
    mutationFn: (body: pharmacy.CreatePrescription) => api.pharmacy.prescriptions.create(body),
    onSuccess: (rx) => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy', 'prescriptions'] });
      router.push(`/pharmacy/queue/${rx.id}`);
    },
  });

  if (!canCreate) return <NoAccess />;
  const submit = () => {
    const r = validate(pharmacy.createPrescriptionSchema, {
      patientId: patient?.id,
      doctorName: doctorName || undefined,
      lines: lines.map((l) => ({
        drugName: l.drugName,
        itemId: l.itemId,
        dose: l.dose || undefined,
        frequency: l.frequency || undefined,
        days: l.days ? Number(l.days) : undefined,
        qty: Number(l.qty || 0),
      })),
    });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  const lineErr = (i: number) => {
    const key = errors && Object.keys(errors).find((k) => k.startsWith(`lines.${i}.`));
    return key ? <p className="col-span-12 text-xs text-destructive">{errors![key]}</p> : null;
  };
  const valid = !!patient && lines.length > 0 && lines.every((l) => l.drugName.trim());

  return (
    <div className="max-w-4xl">
      <Link href="/pharmacy/queue" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Prescription queue
      </Link>
      <PageHeader title="Paper prescription" description="Type in a prescription the patient brought, then dispense it." />
      <div className="space-y-6">
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div>
              <Label>Patient *</Label>
              <div className="mt-2">
                <PatientPicker value={patient} onChange={setPatient} />
              </div>
            </div>
            <div>
              <Label htmlFor="doctor">Doctor</Label>
              <Input id="doctor" className="mt-2" maxLength={120} value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Drugs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ItemPicker onPick={(it) => setLines((ls) => [...ls, { key: nextKey++, drugName: it.name, itemId: it.id, dose: '', frequency: '', days: '', qty: '' }])} />
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-12 gap-2">
                <Input className="col-span-4" placeholder="Drug" value={l.drugName} onChange={(e) => set(l.key, { drugName: e.target.value, itemId: undefined })} />
                <Input className="col-span-2" placeholder="Dose" value={l.dose} onChange={(e) => set(l.key, { dose: e.target.value })} />
                <Input className="col-span-2" placeholder="Freq (BD/TDS)" value={l.frequency} onChange={(e) => set(l.key, { frequency: e.target.value })} />
                <Input className="col-span-1" placeholder="Days" type="number" min={0} max={365} step={1} value={l.days} onChange={(e) => set(l.key, { days: e.target.value })} />
                <Input className="col-span-2" placeholder="Total qty" type="number" min={0} step={1} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 />
                </Button>
                {lineErr(i)}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: nextKey++, drugName: '', dose: '', frequency: '', days: '', qty: '' }])}>
              <Plus /> Drug not in master
            </Button>
          </CardContent>
        </Card>
        {errors && <p className="text-sm text-destructive">{firstError(errors)}</p>}
        {save.error && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
        <div className="flex justify-end">
          <Button disabled={!valid || save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" />} Add to queue
          </Button>
        </div>
      </div>
    </div>
  );
}
