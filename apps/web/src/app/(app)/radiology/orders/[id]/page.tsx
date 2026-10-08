'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, FileSignature, Loader2, Play, Printer, ReceiptIndianRupee, X } from 'lucide-react';
import { radiology as R, type radiology } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrderStatusBadge, PriorityBadge, Textarea, dateTime, localInputValue, localToIso, patientLine, rupees } from '@/modules/radiology/ui';

type OrderWithReports = radiology.OrderWithReports;
type Order = radiology.RadiologyOrder;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function useOrderMutation<T>(id: string, fn: (v: T) => Promise<unknown>, after?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['radiology', 'order', id] });
      void qc.invalidateQueries({ queryKey: ['radiology', 'orders'] });
      after?.();
    },
  });
}

function TestPicker({ order }: { order: Order }) {
  const tests = useQuery({ queryKey: ['radiology', 'tests'], queryFn: () => api.radiology.tests() });
  const [testId, setTestId] = React.useState('');
  const save = useOrderMutation(order.id, () => api.radiology.updateOrder(order.id, { testId }));
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <p className="mb-2">
        The doctor wrote <b>{order.studyName}</b>, which is not in the test list. Pick the matching test to book and bill it.
      </p>
      <div className="flex gap-2">
        <Select value={testId} onChange={(e) => setTestId(e.target.value)}>
          <option value="">Pick a test</option>
          {tests.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.modalityName}: {t.name}
            </option>
          ))}
        </Select>
        <Button disabled={!testId || save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </div>
      {save.error && <p className="mt-2 text-destructive">{errorMessage(save.error)}</p>}
    </div>
  );
}

function ScanActions({ order }: { order: Order }) {
  const modalities = useQuery({ queryKey: ['radiology', 'modalities'], queryFn: () => api.radiology.modalities() });
  const [when, setWhen] = React.useState('');
  const [modalityId, setModalityId] = React.useState(order.modalityId ?? '');
  const [studyUid, setStudyUid] = React.useState('');
  const [imagesUrl, setImagesUrl] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState<string | null>(null);
  const [checkError, setCheckError] = React.useState<string | null>(null);
  const schedule = useOrderMutation(order.id, (body: radiology.ScheduleOrder) => api.radiology.schedule(order.id, body));
  const start = useOrderMutation(order.id, () => api.radiology.start(order.id));
  const complete = useOrderMutation(order.id, (body: radiology.CompleteScan) => api.radiology.complete(order.id, body));
  const cancel = useOrderMutation(order.id, () => api.radiology.cancel(order.id, { reason: cancelReason ?? '' }));
  const error = schedule.error ?? start.error ?? complete.error ?? cancel.error;

  // Check with the shared schema first, so a past slot or a bad link never leaves the page.
  const book = () => {
    if (Number.isNaN(new Date(when).getTime())) return setCheckError('Pick the slot date and time');
    const checked = validate(R.scheduleOrderSchema, { scheduledAt: localToIso(when), modalityId: modalityId || undefined });
    setCheckError(firstError(checked.errors));
    if (checked.data) schedule.mutate(checked.data);
  };
  const done = () => {
    const checked = validate(R.completeScanSchema, { studyUid: studyUid.trim() || undefined, imagesUrl: imagesUrl.trim() || undefined });
    setCheckError(firstError(checked.errors));
    if (checked.data) complete.mutate(checked.data);
  };
  const canBook = order.status === 'ordered' || order.status === 'scheduled';
  const canScan = canBook || order.status === 'in_progress';
  const canCancel = !['finalized', 'cancelled'].includes(order.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canBook && (
          <Can permission="radiology.order.schedule">
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="when">{order.status === 'scheduled' ? 'Move slot to' : 'Book slot'}</Label>
                <Input id="when" type="datetime-local" className="mt-1.5" min={localInputValue()} max={localInputValue(R.SCHEDULE_MAX_DAYS_AHEAD * 24 * 60)} value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="machine">Machine</Label>
                <Select id="machine" className="mt-1.5" value={modalityId} onChange={(e) => setModalityId(e.target.value)}>
                  {modalities.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </div>
              </div>
              <Button variant="outline" disabled={!when || schedule.isPending} onClick={book}>
                <CalendarClock /> {order.status === 'scheduled' ? 'Move slot' : 'Book slot'}
              </Button>
            </div>
          </Can>
        )}
        {canScan && (
          <Can permission="radiology.order.schedule">
            <div className="space-y-2">
              {order.status !== 'in_progress' && (
                <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate(undefined)}>
                  <Play /> Patient on the machine
                </Button>
              )}
              <div className="space-y-2">
                <Input placeholder="Study UID from the machine (optional)" maxLength={64} value={studyUid} onChange={(e) => setStudyUid(e.target.value)} />
                <Input type="url" inputMode="url" placeholder="PACS viewer link, https://… (optional)" maxLength={1000} value={imagesUrl} onChange={(e) => setImagesUrl(e.target.value)} />
              </div>
              <Button disabled={complete.isPending} onClick={done}>
                <CheckCircle2 /> Scan done, send for reporting
              </Button>
            </div>
          </Can>
        )}
        {canCancel && (
          <Can permission="radiology.order.cancel">
            {cancelReason === null ? (
              <Button variant="ghost" className="text-destructive" onClick={() => setCancelReason('')}>
                <X /> Cancel order
              </Button>
            ) : (
              <div className="flex gap-2">
                <Input autoFocus placeholder="Why is it cancelled? (at least 3 characters)" maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                <Button variant="destructive" disabled={cancelReason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                  Cancel order
                </Button>
                <Button variant="ghost" onClick={() => setCancelReason(null)}>
                  Keep
                </Button>
              </div>
            )}
          </Can>
        )}
        {!canScan && <p className="text-sm text-muted-foreground">Scan done{order.acquiredAt ? ` on ${dateTime(order.acquiredAt)}` : ''}.</p>}
        {(checkError || error) && <p className="text-sm text-destructive">{checkError ?? errorMessage(error)}</p>}
      </CardContent>
    </Card>
  );
}

function BillCard({ order }: { order: Order }) {
  const canCollect = usePermission('billing.payment.collect');
  const test = useQuery({ queryKey: ['radiology', 'test', order.testId], queryFn: () => api.radiology.test(order.testId!), enabled: !!order.testId });
  const [mode, setMode] = React.useState<'none' | 'cash' | 'upi' | 'card'>('cash');
  const amount = test.data?.price ?? null;
  const bill = useOrderMutation(order.id, () =>
    api.radiology.bill(order.id, mode !== 'none' && amount ? { payNow: { mode, amount } } : {}),
  );
  if (order.invoiceId) {
    return (
      <Row label="Bill">
        <Link href={`/billing/invoices/${order.invoiceId}`} className="underline">
          {order.invoiceNo ?? 'Draft bill'}
        </Link>
      </Row>
    );
  }
  if (order.status === 'cancelled' || !order.testId) return null;
  return (
    <Can permission="radiology.order.bill">
      <div className="mt-3 space-y-2 border-t pt-3">
        <p className="text-sm">
          Not billed yet{test.data?.serviceCode ? ' (price from billing services)' : amount != null ? `: ${rupees(amount)}` : ''}.
        </p>
        <div className="flex gap-2">
          {canCollect && !test.data?.serviceCode && (
            <Select className="w-36" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Payment">
              <option value="cash">Paid cash</option>
              <option value="upi">Paid UPI</option>
              <option value="card">Paid card</option>
              <option value="none">Pay later</option>
            </Select>
          )}
          <Button variant="outline" disabled={bill.isPending} onClick={() => bill.mutate(undefined)}>
            <ReceiptIndianRupee /> Raise bill
          </Button>
        </div>
        {bill.error && <p className="text-sm text-destructive">{errorMessage(bill.error)}</p>}
      </div>
    </Can>
  );
}

function ReportEditor({ data }: { data: OrderWithReports }) {
  const { order, reports } = data;
  const draft = reports.find((r) => r.status === 'draft');
  const final = reports.find((r) => r.status === 'final');
  const canWrite = usePermission('radiology.report.write');
  const canFinalize = usePermission('radiology.report.finalize');
  const templates = useQuery({
    queryKey: ['radiology', 'templates', order.modalityId],
    queryFn: () => api.radiology.templates({ modalityId: order.modalityId ?? undefined }),
    enabled: canWrite,
  });
  const test = useQuery({ queryKey: ['radiology', 'test', order.testId], queryFn: () => api.radiology.test(order.testId!), enabled: canWrite && !!order.testId });
  const [form, setForm] = React.useState<radiology.SaveReport | null>(null);
  const [amendReason, setAmendReason] = React.useState<string | null>(null);

  // Until the radiologist types, show the draft, or the test's default template for a first report.
  const initial = ((): radiology.SaveReport => {
    if (draft) return { templateId: draft.templateId ?? undefined, technique: draft.technique ?? '', findings: draft.findings, impression: draft.impression, isCritical: draft.isCritical };
    const t = !final && test.data?.defaultTemplateId ? templates.data?.find((x) => x.id === test.data!.defaultTemplateId) : undefined;
    if (t) return { templateId: t.id, technique: t.technique ?? '', findings: t.findings ?? '', impression: t.impression ?? '', isCritical: false };
    return { technique: '', findings: '', impression: '', isCritical: false };
  })();
  const f = form ?? initial;
  const set = (patch: Partial<radiology.SaveReport>) => setForm({ ...f, ...patch });
  const reset = () => {
    setForm(null);
    setAmendReason(null);
  };
  const save = useOrderMutation(order.id, () => api.radiology.saveReport(order.id, f));
  const finalize = useOrderMutation(
    order.id,
    async () => {
      await api.radiology.saveReport(order.id, f);
      return api.radiology.finalizeReport(order.id);
    },
    reset,
  );
  const amend = useOrderMutation(order.id, () => api.radiology.amendReport(order.id, { reason: amendReason ?? '' }), reset);
  const discard = useOrderMutation(order.id, () => api.radiology.discardDraft(order.id), reset);
  const error = save.error ?? finalize.error ?? amend.error ?? discard.error;

  const editable = canWrite && (!!draft || ['in_progress', 'acquired', 'reported'].includes(order.status));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Report</CardTitle>
        {final && (
          <Link href={`/radiology/reports/${final.id}/print`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Printer /> Print report
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {final && !draft && (
          <div className="space-y-2 text-sm">
            {final.isCritical && (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 size-3" /> Critical finding
              </Badge>
            )}
            {final.technique && (
              <p>
                <b>Technique:</b> {final.technique}
              </p>
            )}
            <p className="whitespace-pre-line">{final.findings}</p>
            <p>
              <b>Impression:</b> <span className="whitespace-pre-line">{final.impression}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Signed by {final.finalizedByName ?? '—'} on {dateTime(final.finalizedAt)} · version {final.version}
            </p>
            {canFinalize &&
              (amendReason === null ? (
                <Button variant="outline" size="sm" onClick={() => setAmendReason('')}>
                  Amend report
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Input autoFocus placeholder="Reason for the amendment" value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
                  <Button disabled={amendReason.trim().length < 3 || amend.isPending} onClick={() => amend.mutate(undefined)}>
                    Start amendment
                  </Button>
                  <Button variant="ghost" onClick={() => setAmendReason(null)}>
                    Back
                  </Button>
                </div>
              ))}
          </div>
        )}

        {!final && !editable && <p className="text-sm text-muted-foreground">The report can be written once the scan is done.</p>}

        {editable && (draft || !final) && (
          <div className="space-y-3">
            {draft?.amendmentReason && <p className="text-sm text-amber-700">Amendment (version {draft.version}): {draft.amendmentReason}</p>}
            <div>
              <Label htmlFor="tpl">Template</Label>
              <Select
                id="tpl"
                className="mt-1.5"
                value={f.templateId ?? ''}
                onChange={(e) => {
                  const t = templates.data?.find((x) => x.id === e.target.value);
                  if (t) set({ templateId: t.id, technique: t.technique ?? '', findings: t.findings ?? '', impression: t.impression ?? '' });
                }}
              >
                <option value="">Start from a template…</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="technique">Technique</Label>
              <Textarea id="technique" className="mt-1.5" rows={2} value={f.technique ?? ''} onChange={(e) => set({ technique: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="findings">Findings</Label>
              <Textarea id="findings" className="mt-1.5 font-mono text-[13px]" rows={12} value={f.findings} onChange={(e) => set({ findings: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="impression">Impression</Label>
              <Textarea id="impression" className="mt-1.5" rows={3} value={f.impression} onChange={(e) => set({ impression: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!f.isCritical} onChange={(e) => set({ isCritical: e.target.checked })} />
              Critical finding (tell the referring doctor now)
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={save.isPending || !f.findings || !f.impression} onClick={() => save.mutate(undefined)}>
                {save.isPending && <Loader2 className="animate-spin" />} Save draft
              </Button>
              {canFinalize && (
                <Button disabled={finalize.isPending || !f.findings || !f.impression} onClick={() => finalize.mutate(undefined)}>
                  {finalize.isPending ? <Loader2 className="animate-spin" /> : <FileSignature />} Sign and finalize
                </Button>
              )}
              {draft && (
                <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate(undefined)}>
                  Discard draft
                </Button>
              )}
            </div>
            {save.isSuccess && !save.isPending && <p className="text-xs text-muted-foreground">Draft saved.</p>}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}

        {reports.filter((r) => r.status !== 'draft').length > 1 && (
          <div className="border-t pt-3 text-sm">
            <p className="mb-1 font-medium">Versions</p>
            <ul className="space-y-1">
              {reports
                .filter((r) => r.status !== 'draft')
                .map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>
                      v{r.version} · {r.status === 'final' ? 'current' : 'replaced'} · {dateTime(r.finalizedAt)}
                      {r.amendmentReason ? ` · ${r.amendmentReason}` : ''}
                    </span>
                    <Link href={`/radiology/reports/${r.id}/print`} className="underline">
                      View
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RadiologyOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('radiology.order.read');
  const canReadReports = usePermission('radiology.report.read');
  const canWriteReports = usePermission('radiology.report.write');
  const { data, isPending, error } = useQuery({ queryKey: ['radiology', 'order', id], queryFn: () => api.radiology.order(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const o = data.order;

  return (
    <div className="space-y-4">
      <Link href="/radiology" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Worklist
      </Link>
      <PageHeader
        title={o.studyName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {o.orderNo} <OrderStatusBadge status={o.status} /> <PriorityBadge priority={o.priority} />
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="font-medium">{o.patient.name}</p>
              <p className="mb-2 text-sm text-muted-foreground">
                {patientLine(o.patient)} {o.patient.mobile ? `· ${o.patient.mobile}` : ''}
              </p>
              <Row label="Machine">{o.modalityName ?? '—'}</Row>
              <Row label="Slot">{dateTime(o.scheduledAt)}</Row>
              <Row label="Referred by">{o.referringDoctorName ?? '—'}</Row>
              <Row label="From">{o.source === 'emr' ? 'OPD consultation' : 'Desk'}</Row>
              {o.clinicalNotes && <Row label="Notes">{o.clinicalNotes}</Row>}
              {o.acquiredAt && <Row label="Scanned">{dateTime(o.acquiredAt)}</Row>}
              {o.imagesUrl && (
                <Row label="Images">
                  <a href={o.imagesUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                    Open viewer <ExternalLink className="size-3" />
                  </a>
                </Row>
              )}
              {o.cancelReason && <Row label="Cancelled">{o.cancelReason}</Row>}
              <BillCard order={o} />
            </CardContent>
          </Card>
          {!o.testId && o.status !== 'cancelled' && (
            <Can permission="radiology.order.create">
              <TestPicker order={o} />
            </Can>
          )}
          {o.testId && o.status !== 'finalized' && o.status !== 'cancelled' && <ScanActions order={o} />}
        </div>
        {canReadReports || canWriteReports ? <ReportEditor data={data} /> : null}
      </div>
    </div>
  );
}

