'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Loader2 } from 'lucide-react';
import type { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AddCapa } from '@/modules/quality/capa-form';
import { CapaList, ErrorBox, StatusBadge, Textarea, formatDateTime, humanize } from '@/modules/quality/ui';

const RESULTS: { value: Q.AuditResult; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
];

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = usePermission('quality.audit.read');
  const canConduct = usePermission('quality.audit.conduct');
  const queryClient = useQueryClient();
  const key = ['quality', 'audits', id];
  const { data: audit, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.quality.audits.get(id), enabled: can });
  const [answers, setAnswers] = React.useState<Record<string, { result?: Q.AuditResult; remark?: string }>>({});
  const [summary, setSummary] = React.useState('');
  const done = (a: Q.Audit) => {
    queryClient.setQueryData(key, a);
    queryClient.invalidateQueries({ queryKey: ['quality'], refetchType: 'none' });
  };
  const submit = useMutation({
    mutationFn: () =>
      api.quality.audits.submit(id, {
        responses: audit!.items.map((i) => ({ itemId: i.id, result: answers[i.id]?.result ?? 'na', remark: answers[i.id]?.remark || undefined })),
        summary: summary || undefined,
      }),
    onSuccess: done,
  });
  const cancel = useMutation({ mutationFn: () => api.quality.audits.cancel(id), onSuccess: done });

  if (!can) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const editable = audit.status === 'scheduled' && canConduct;
  const answered = audit.items.filter((i) => answers[i.id]?.result).length;

  return (
    <div className="space-y-6">
      <Link href="/quality/audits" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All audits
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {audit.checklistName} <StatusBadge status={audit.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {audit.auditNo} · {humanize(audit.category)} · {audit.department ?? 'All departments'} · scheduled {audit.scheduledOn}
            {audit.auditor && ` · auditor ${audit.auditor.name}`}
            {audit.conductedAt && ` · done ${formatDateTime(audit.conductedAt)}`}
          </p>
        </div>
        {audit.score != null && (
          <div className="rounded-xl border px-5 py-3 text-center">
            <div className="text-xs text-muted-foreground">Compliance</div>
            <div className="text-2xl font-semibold tabular-nums">{audit.score.toFixed(1)}%</div>
          </div>
        )}
      </div>
      <ErrorBox error={submit.error ?? cancel.error} />

      <Card>
        <CardHeader>
          <CardTitle>{editable ? `Checklist (${answered} of ${audit.items.length} answered)` : 'Checklist'}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {audit.items.map((item, idx) => {
              const a = editable ? answers[item.id] : { result: item.result ?? undefined, remark: item.remark ?? undefined };
              return (
                <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <span className="flex-1 text-sm">
                    {idx + 1}. {item.text}
                  </span>
                  <div className="flex gap-1" role="radiogroup" aria-label={item.text}>
                    {RESULTS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        role="radio"
                        aria-checked={a?.result === r.value}
                        disabled={!editable}
                        onClick={() => setAnswers({ ...answers, [item.id]: { ...answers[item.id], result: r.value } })}
                        className={cn(
                          'h-8 w-12 rounded-md border text-xs font-medium',
                          a?.result === r.value && r.value === 'yes' && 'border-transparent bg-accent/20',
                          a?.result === r.value && r.value === 'no' && 'border-transparent bg-destructive/15 text-destructive',
                          a?.result === r.value && r.value === 'na' && 'border-transparent bg-muted',
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {editable ? (
                    <Input
                      aria-label={`Remark for item ${idx + 1}`}
                      className="sm:w-56"
                      placeholder="Remark"
                      value={a?.remark ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [item.id]: { ...answers[item.id], remark: e.target.value } })}
                    />
                  ) : (
                    a?.remark && <span className="text-xs text-muted-foreground sm:w-56">{a.remark}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {editable ? (
            <div className="mt-4 space-y-3">
              <Textarea placeholder="Summary / observations" value={summary} onChange={(e) => setSummary(e.target.value)} />
              <div className="flex gap-2">
                <Button disabled={submit.isPending || answered < audit.items.length} onClick={() => submit.mutate()}>
                  {submit.isPending && <Loader2 className="animate-spin" />} Submit audit
                </Button>
                <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  <Ban /> Cancel audit
                </Button>
              </div>
            </div>
          ) : (
            audit.summary && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{audit.summary}</p>
          )}
        </CardContent>
      </Card>

      {audit.status === 'completed' && (
        <Card>
          <CardHeader>
            <CardTitle>Non-compliances: {audit.nonCompliant}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CapaList items={audit.capas} />
            {audit.nonCompliant > 0 && (
              <AddCapa
                sourceType="audit"
                sourceId={audit.id}
                defaultProblem={audit.items
                  .filter((i) => i.result === 'no')
                  .map((i) => `• ${i.text}${i.remark ? ` (${i.remark})` : ''}`)
                  .join('\n')}
                onCreated={() => queryClient.invalidateQueries({ queryKey: key })}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
