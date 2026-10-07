'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer, TriangleAlert } from 'lucide-react';
import { ops as O, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DIET_LABELS, ErrorBox, Field, MEAL_LABELS, MessageRow, Pager, PatientPicker, Tabs, formatDay, humanize, opt, todayIST } from '@/modules/ops/ui';

function defaultMeal(): O.Meal {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'evening_snack';
  return 'dinner';
}

function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      title={veg ? 'Vegetarian' : 'Non-vegetarian'}
      className={cn('inline-flex size-4 items-center justify-center rounded-sm border-2', veg ? 'border-green-700' : 'border-red-700')}
    >
      <span className={cn('size-1.5 rounded-full', veg ? 'bg-green-700' : 'bg-red-700')} />
    </span>
  );
}

function Allergies({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div className="mt-1 inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
      <TriangleAlert className="size-3" /> Allergy: {list.join(', ')}
    </div>
  );
}

function OrderForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [f, setF] = React.useState({ location: '', dietType: 'normal' as O.DietType, vegetarian: true, instructions: '', startDate: todayIST(), endDate: '' });
  const save = useMutation({
    mutationFn: () =>
      api.ops.diet.order({
        patientId: patient!.id,
        location: f.location.trim(),
        dietType: f.dietType,
        vegetarian: f.vegetarian,
        instructions: opt(f.instructions),
        startDate: opt(f.startDate),
        endDate: opt(f.endDate),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Order diet</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (patient) save.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          </div>
          <div className="sm:col-span-2">
            <PatientPicker value={patient} onChange={setPatient} label="Patient *" />
          </div>
          <Field id="d-loc" label="Ward / bed *" className="sm:col-span-2">
            <Input id="d-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Ward 2 / Bed 14" required />
          </Field>
          <Field id="d-type" label="Diet *">
            <Select id="d-type" value={f.dietType} onChange={(e) => setF({ ...f, dietType: e.target.value as O.DietType })}>
              {O.DIET_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DIET_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="d-veg" label="Food preference">
            <Select id="d-veg" value={f.vegetarian ? 'veg' : 'nonveg'} onChange={(e) => setF({ ...f, vegetarian: e.target.value === 'veg' })}>
              <option value="veg">Vegetarian</option>
              <option value="nonveg">Non-vegetarian</option>
            </Select>
          </Field>
          <Field id="d-start" label="From">
            <Input id="d-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field id="d-end" label="Until (optional)">
            <Input id="d-end" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field id="d-instr" label="Instructions" className="sm:col-span-4">
            <Input id="d-instr" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="e.g. 1500 kcal, no sugar, Ryle's tube feed 200 ml 2-hourly" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-3">Allergies recorded on the patient&apos;s profile are shown to the kitchen automatically.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !patient}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Order
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function OrdersTab() {
  const canOrder = usePermission('ops.diet.order');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<'active' | 'stopped'>('active');
  const [page, setPage] = React.useState(1);
  const query: O.DietOrderQuery = { status, page, pageSize: 50 };
  const { data, isPending, error } = useQuery({ queryKey: ['ops', 'diet', 'orders', query], queryFn: () => api.ops.diet.orders(query), placeholderData: keepPreviousData });
  const stop = useMutation({
    mutationFn: (id: string) => api.ops.diet.stop(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ops'] }),
  });

  return (
    <Card>
      <div className="flex items-center gap-3 border-b p-4">
        <Select
          className="w-44"
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'active' | 'stopped');
            setPage(1);
          }}
        >
          <option value="active">Active orders</option>
          <option value="stopped">Stopped orders</option>
        </Select>
      </div>
      {stop.error && (
        <div className="p-4 pb-0">
          <ErrorBox error={errorMessage(stop.error)} />
        </div>
      )}
      {error ? (
        <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Patient</TableHead>
              <TableHead>Ward / bed</TableHead>
              <TableHead>Diet</TableHead>
              <TableHead>Instructions</TableHead>
              <TableHead>Period</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <MessageRow cols={6}>Loading…</MessageRow>
            ) : data.items.length === 0 ? (
              <MessageRow cols={6}>No {status} diet orders.</MessageRow>
            ) : (
              data.items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.patientName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{o.patientUhid}</div>
                    <Allergies list={o.allergies} />
                  </TableCell>
                  <TableCell>{o.location}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <VegMark veg={o.vegetarian} />
                      <span className={o.dietType === 'npo' ? 'font-semibold text-destructive' : 'font-medium'}>{DIET_LABELS[o.dietType]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-xs">{o.instructions ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    {formatDay(o.startDate)} – {o.endDate ? formatDay(o.endDate) : 'ongoing'}
                    {o.orderedBy && <div className="text-muted-foreground">by {o.orderedBy}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {canOrder && o.status === 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={stop.isPending}
                        onClick={() => {
                          if (window.confirm(`Stop the diet order for ${o.patientName}?`)) stop.mutate(o.id);
                        }}
                      >
                        Stop
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
  );
}

const MEAL_STATUS_STYLE: Record<O.MealStatus, 'accent' | 'default' | 'destructive' | 'secondary'> = {
  prepared: 'default',
  delivered: 'accent',
  refused: 'destructive',
  skipped: 'secondary',
};

function KitchenSheetTab() {
  const canServe = usePermission('ops.diet.serve');
  const queryClient = useQueryClient();
  const [date, setDate] = React.useState(todayIST());
  const [meal, setMeal] = React.useState<O.Meal>(defaultMeal);
  const key = ['ops', 'diet', 'kitchen-sheet', date, meal];
  const { data, isPending, error, isFetching } = useQuery({ queryKey: key, queryFn: () => api.ops.diet.kitchenSheet({ date, meal }) });
  const mark = useMutation({
    mutationFn: (v: { orderId: string; status: O.MealStatus }) => api.ops.diet.markMeal({ orderId: v.orderId, date, meal, status: v.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const totals = data?.counts.reduce((a, c) => ({ veg: a.veg + c.vegetarian, non: a.non + c.nonVegetarian }), { veg: 0, non: 0 });

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #kitchen-sheet, #kitchen-sheet * { visibility: visible !important; }
        #kitchen-sheet { position: absolute; left: 0; top: 0; width: 100%; border: 0; box-shadow: none; }
        @page { size: A4; margin: 10mm; }
      }`}</style>
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <Field id="ks-date" label="Date">
          <Input id="ks-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="ks-meal" label="Meal">
          <Select id="ks-meal" value={meal} onChange={(e) => setMeal(e.target.value as O.Meal)}>
            {O.MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="outline" onClick={() => window.print()} disabled={!data}>
          <Printer /> Print sheet
        </Button>
        {isFetching && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card id="kitchen-sheet">
          <CardHeader>
            <CardTitle>
              Kitchen sheet · {MEAL_LABELS[data.meal]} · {formatDay(data.date)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {data.rows.length} patients · {totals?.veg ?? 0} veg + {totals?.non ?? 0} non-veg trays
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {data.counts.map((c) => (
                <div key={c.dietType} className="rounded-md border p-2">
                  <div className="text-xs font-medium">{DIET_LABELS[c.dietType]}</div>
                  <div className="mt-1 flex items-center gap-3 text-lg font-semibold tabular-nums">
                    <span className="flex items-center gap-1">
                      <VegMark veg /> {c.vegetarian}
                    </span>
                    <span className="flex items-center gap-1">
                      <VegMark veg={false} /> {c.nonVegetarian}
                    </span>
                  </div>
                </div>
              ))}
              {data.counts.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No trays for this meal.</p>}
            </div>
            <ErrorBox error={mark.error ? errorMessage(mark.error) : null} />
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ward / bed</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Diet</TableHead>
                  <TableHead>Instructions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="print:hidden" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.length === 0 ? (
                  <MessageRow cols={6}>No active diet orders.</MessageRow>
                ) : (
                  data.rows.map((r) => (
                    <TableRow key={r.id} className={r.allergies.length ? 'bg-destructive/5' : undefined}>
                      <TableCell className="font-medium">{r.location}</TableCell>
                      <TableCell>
                        {r.patientName} <span className="font-mono text-xs text-muted-foreground">{r.patientUhid}</span>
                        <div>
                          <Allergies list={r.allergies} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <VegMark veg={r.vegetarian} />
                          <span className={r.dietType === 'npo' ? 'font-semibold text-destructive' : ''}>{DIET_LABELS[r.dietType]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-xs">{r.instructions ?? ''}</TableCell>
                      <TableCell>{r.mealStatus ? <Badge variant={MEAL_STATUS_STYLE[r.mealStatus]}>{humanize(r.mealStatus)}</Badge> : <span className="text-xs text-muted-foreground">Pending</span>}</TableCell>
                      <TableCell className="text-right print:hidden">
                        {canServe && r.dietType !== 'npo' && (
                          <div className="flex justify-end gap-1">
                            {(['prepared', 'delivered', 'refused'] as const).map((s) => (
                              <Button
                                key={s}
                                size="sm"
                                variant={r.mealStatus === s ? 'default' : s === 'refused' ? 'ghost' : 'outline'}
                                disabled={mark.isPending}
                                onClick={() => mark.mutate({ orderId: r.id, status: s })}
                              >
                                {humanize(s)}
                              </Button>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function DietPage() {
  const canRead = usePermission('ops.diet.read');
  const canOrder = usePermission('ops.diet.order');
  const [tab, setTab] = React.useState<'orders' | 'kitchen'>('orders');
  const [ordering, setOrdering] = React.useState(false);

  if (!canRead) return <NoAccess />;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Diet kitchen"
          description="Patient diet orders and the per-meal kitchen sheet."
          actions={
            <Can permission="ops.diet.order">
              <Button
                onClick={() => {
                  setOrdering(true);
                  setTab('orders');
                }}
              >
                <Plus /> Order diet
              </Button>
            </Can>
          }
        />
      </div>
      <Tabs
        tabs={[
          { key: 'orders', label: 'Diet orders' },
          { key: 'kitchen', label: 'Kitchen sheet' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'orders' ? (
        <>
          {canOrder && ordering && <OrderForm onDone={() => setOrdering(false)} />}
          <OrdersTab />
        </>
      ) : (
        <KitchenSheetTab />
      )}
    </>
  );
}
