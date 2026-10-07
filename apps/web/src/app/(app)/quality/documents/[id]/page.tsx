'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, CheckCircle2, ExternalLink, FilePlus2, Loader2, Printer } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field, StatusBadge, Textarea, formatDateTime, humanize } from '@/modules/quality/ui';

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = usePermission('quality.document.read');
  const canManage = usePermission('quality.document.manage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = ['quality', 'documents', id];
  const { data: d, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.quality.documents.get(id), enabled: can });
  const done = (next: Q.QualityDocument) => {
    queryClient.invalidateQueries({ queryKey: ['quality', 'documents'] });
    if (next.id !== id) router.push(`/quality/documents/${next.id}`);
    else queryClient.setQueryData(key, next);
  };
  const approve = useMutation({ mutationFn: () => api.quality.documents.approve(id), onSuccess: done });
  const revise = useMutation({ mutationFn: () => api.quality.documents.revise(id), onSuccess: done });
  const archive = useMutation({ mutationFn: () => api.quality.documents.archive(id), onSuccess: done });

  if (!can) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="space-y-6">
      <Link href="/quality/documents" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 print:hidden' })}>
        <ArrowLeft /> All documents
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {d.title} <StatusBadge status={d.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.code} · version {d.version} · {d.chapter}: {Q.NABH_CHAPTERS[d.chapter]} · {humanize(d.docType)}
            {d.effectiveFrom && ` · effective ${d.effectiveFrom}`}
            {d.reviewDue && ` · review by ${d.reviewDue}`}
            {d.approvedBy && ` · approved by ${d.approvedBy.name} ${formatDateTime(d.approvedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          {canManage && d.status === 'draft' && (
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve
            </Button>
          )}
          {canManage && d.status !== 'draft' && (
            <Button variant="outline" disabled={revise.isPending} onClick={() => revise.mutate()}>
              <FilePlus2 /> New version
            </Button>
          )}
          {canManage && d.status === 'approved' && (
            <Button variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate()}>
              <Archive /> Archive
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={approve.error ?? revise.error ?? archive.error} />

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {canManage && d.status === 'draft' ? (
            <DraftEditor key={d.id} d={d} onSaved={done} />
          ) : (
            <Card>
              <CardContent className="space-y-4 pt-6">
                {d.fileUrl && (
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <ExternalLink className="size-4" /> Open attached file
                  </a>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{d.content ?? (d.fileUrl ? '' : 'No content.')}</div>
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="h-fit print:hidden">
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {d.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between">
                  <Link href={`/quality/documents/${v.id}`} className={v.id === d.id ? 'font-semibold' : 'text-primary hover:underline'}>
                    v{v.version}
                  </Link>
                  <StatusBadge status={v.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DraftEditor({ d, onSaved }: { d: Q.QualityDocument; onSaved: (d: Q.QualityDocument) => void }) {
  const [f, setF] = React.useState({
    title: d.title,
    department: d.department ?? '',
    content: d.content ?? '',
    fileUrl: d.fileUrl ?? '',
    effectiveFrom: d.effectiveFrom ?? '',
    reviewDue: d.reviewDue ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api.quality.documents.update(d.id, {
        title: f.title,
        department: f.department,
        content: f.content,
        fileUrl: f.fileUrl || undefined,
        effectiveFrom: f.effectiveFrom || undefined,
        reviewDue: f.reviewDue || undefined,
      }),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit draft</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
          <Field id="title" label="Title" className="sm:col-span-2">
            <Input id="title" required value={f.title} onChange={set('title')} />
          </Field>
          <Field id="department" label="Department">
            <Input id="department" value={f.department} onChange={set('department')} />
          </Field>
          <Field id="fileUrl" label="File link (optional)" hint="Link to a PDF in your document storage">
            <Input id="fileUrl" type="url" value={f.fileUrl} onChange={set('fileUrl')} />
          </Field>
          <Field id="effectiveFrom" label="Effective from" hint="Defaults to the approval date">
            <Input id="effectiveFrom" type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
          </Field>
          <Field id="reviewDue" label="Review due" hint="Defaults to one year after it takes effect">
            <Input id="reviewDue" type="date" value={f.reviewDue} onChange={set('reviewDue')} />
          </Field>
          <Field id="content" label="Content" className="sm:col-span-2">
            <Textarea id="content" rows={18} value={f.content} onChange={set('content')} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save draft
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
