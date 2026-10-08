'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CAMP_TYPE_LABELS, ErrorBox, Field, Pager, Select, Textarea, addDaysISO, formatINR, todayIST } from '@/modules/crm/ui';

interface Form {
  id?: string;
  name: string;
  type: C.CampType;
  location: string;
  startsOn: string;
  endsOn: string;
  status: C.CampStatus;
  targetCount: string;
  budget: string;
  spent: string;
  notes: string;
}

const STATUS_VARIANT: Record<C.CampStatus, 'default' | 'secondary' | 'accent' | 'destructive'> = {
  planned: 'default',
  ongoing: 'accent',
  completed: 'secondary',
  cancelled: 'destructive',
};

export default function CampsPage() {
  const canRead = usePermission('crm.camp.read');
  const canManage = usePermission('crm.camp.manage');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<Form | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const campBody = (f: Form) => {
    const num = (v: string) => (v === '' ? null : Number(v));
    return { name: f.name, type: f.type, location: f.location || null, startsOn: f.startsOn, endsOn: f.endsOn, targetCount: num(f.targetCount), budget: num(f.budget), spent: num(f.spent), notes: f.notes || null };
  };

  const query: C.CampQuery = { status: (status || undefined) as C.CampStatus | undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['crm', 'camps', query],
    queryFn: () => api.crm.camps.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const save = useMutation({
    mutationFn: (f: Form) => {
      const common = campBody(f);
      return f.id ? api.crm.camps.update(f.id, { ...common, status: f.status }) : api.crm.camps.create(common);
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Health camps"
        description="Plan camps and capture visitors as enquiries (pick the camp on the enquiry) to see how many became patients."
        actions={
          <Can permission="crm.camp.manage">
            <Button
              onClick={() =>
                setForm({ name: '', type: 'health_camp', location: '', startsOn: todayIST(), endsOn: todayIST(), status: 'planned', targetCount: '', budget: '', spent: '', notes: '' })
              }
            >
              <Plus /> Plan a camp
            </Button>
          </Can>
        }
      />

      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.name}` : 'Plan a camp'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : Object.keys(errors).length ? 'Please correct the highlighted fields.' : null} />
            <div className="grid gap-4 sm:grid-cols-4">
              <Field id="cp-name" label="Name *" className="sm:col-span-2" error={errors.name}>
                <Input id="cp-name" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Free diabetes screening, Hadapsar" />
              </Field>
              <Field id="cp-type" label="Type">
                <Select id="cp-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as C.CampType })}>
                  {C.CAMP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CAMP_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.id ? (
                <Field id="cp-status" label="Status" error={errors.status}>
                  <Select id="cp-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as C.CampStatus })}>
                    {C.CAMP_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div />
              )}
              <Field id="cp-loc" label="Location" className="sm:col-span-2" error={errors.location}>
                <Input id="cp-loc" maxLength={300} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field id="cp-from" label="From *" error={errors.startsOn}>
                <Input id="cp-from" type="date" min={form.id ? undefined : addDaysISO(todayIST(), -366)} max={addDaysISO(todayIST(), 2 * 366)} value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
              </Field>
              <Field id="cp-to" label="To *" error={errors.endsOn}>
                <Input id="cp-to" type="date" min={form.startsOn || undefined} max={form.startsOn ? addDaysISO(form.startsOn, C.MAX_CAMP_DAYS - 1) : undefined} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
              </Field>
              <Field id="cp-target" label="Target visitors" error={errors.targetCount}>
                <Input id="cp-target" type="number" min={0} step={1} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: e.target.value })} />
              </Field>
              <Field id="cp-budget" label="Budget (₹)" error={errors.budget}>
                <Input id="cp-budget" type="number" min={0} step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              </Field>
              <Field id="cp-spent" label="Spent (₹)" error={errors.spent}>
                <Input id="cp-spent" type="number" min={0} step="0.01" value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} />
              </Field>
              <Field id="cp-notes" label="Notes" className="sm:col-span-4" error={errors.notes}>
                <Textarea id="cp-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button disabled={save.isPending || !form.name.trim()} onClick={() => {
                  const body = campBody(form);
                  const r = form.id ? validate(C.updateCampSchema, { ...body, status: form.status }) : validate(C.campInputSchema, body);
                  setErrors(r.errors ?? {});
                  if (!r.errors) save.mutate(form);
                }}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-3 border-b p-4">
          <Select
            aria-label="Status"
            className="w-40"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All camps</option>
            {C.CAMP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Camp</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Enquiries</TableHead>
                <TableHead className="text-right">Became patients</TableHead>
                <TableHead className="text-right">Spent / budget</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No camps yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.code} · {CAMP_TYPE_LABELS[c.type]}
                        {c.location && ` · ${c.location}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatDate(c.startsOn)}
                      {c.endsOn !== c.startsOn && ` – ${formatDate(c.endsOn)}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.leadCount}
                      {c.targetCount != null && <span className="text-muted-foreground"> / {c.targetCount}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.convertedCount}
                      {c.leadCount > 0 && <span className="text-muted-foreground"> ({Math.round((c.convertedCount / c.leadCount) * 100)}%)</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(c.spent)} / {formatINR(c.budget)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({
                              id: c.id,
                              name: c.name,
                              type: c.type,
                              location: c.location ?? '',
                              startsOn: c.startsOn,
                              endsOn: c.endsOn,
                              status: c.status,
                              targetCount: c.targetCount?.toString() ?? '',
                              budget: c.budget?.toString() ?? '',
                              spent: c.spent?.toString() ?? '',
                              notes: c.notes ?? '',
                            })
                          }
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
