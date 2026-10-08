'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EnumSelect, ErrorBox, Field, Pager, StatusBadge, humanize } from '@/modules/quality/ui';

const CHAPTERS = Object.keys(Q.NABH_CHAPTERS) as Q.NabhChapter[];
const CHAPTER_LABELS = Object.fromEntries(CHAPTERS.map((c) => [c, `${c}: ${Q.NABH_CHAPTERS[c]}`])) as Record<Q.NabhChapter, string>;

export default function DocumentsPage() {
  return (
    <React.Suspense>
      <Documents />
    </React.Suspense>
  );
}

function Documents() {
  const can = usePermission('quality.document.read');
  const canManage = usePermission('quality.document.manage');
  const router = useRouter();
  const params = useSearchParams();
  const [chapter, setChapter] = React.useState<Q.NabhChapter | ''>('');
  const [docType, setDocType] = React.useState<Q.DocumentType | ''>('');
  const [status, setStatus] = React.useState<Q.DocumentStatus | ''>('');
  const [reviewDue, setReviewDue] = React.useState(params.get('reviewDue') === 'true');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const query = {
    chapter: chapter || undefined,
    docType: docType || undefined,
    status: status || undefined,
    reviewDue: reviewDue ? ('true' as const) : undefined,
    q: q.trim() || undefined,
    page,
    pageSize: 50,
  };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'documents', query],
    queryFn: () => api.quality.documents.list(query),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="NABH documents"
        description="Policies, SOPs, manuals, plans and forms, arranged by NABH chapter. Only approved versions are shown to staff."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> New document
            </Button>
          )
        }
      />
      <div className="space-y-6">
        {adding && <NewDocument onDone={(id) => (id ? router.push(`/quality/documents/${id}`) : setAdding(false))} />}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" className="pl-9" placeholder="Code or title" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
            </div>
            <div className="w-72">
              <EnumSelect value={chapter} onChange={(v) => (setChapter(v), setPage(1))} options={CHAPTERS} labels={CHAPTER_LABELS} placeholder="All chapters" />
            </div>
            <div className="w-36">
              <EnumSelect value={docType} onChange={(v) => (setDocType(v), setPage(1))} options={Q.DOCUMENT_TYPES} placeholder="Any type" />
            </div>
            {canManage && (
              <div className="w-36">
                <EnumSelect value={status} onChange={(v) => (setStatus(v), setPage(1))} options={Q.DOCUMENT_STATUSES} placeholder="Current" />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reviewDue} onChange={(e) => (setReviewDue(e.target.checked), setPage(1))} /> Review due in 30 days
            </label>
          </div>
          {error && <p className="px-4 pt-3 text-sm text-destructive">{errorMessage(error)}</p>}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Chapter</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Review due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No documents found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/quality/documents/${d.id}`)}>
                    <TableCell className="font-mono text-xs">{d.code}</TableCell>
                    <TableCell className="font-medium">{d.title}</TableCell>
                    <TableCell title={Q.NABH_CHAPTERS[d.chapter]}>{d.chapter}</TableCell>
                    <TableCell>{humanize(d.docType)}</TableCell>
                    <TableCell>v{d.version}</TableCell>
                    <TableCell>
                      {d.reviewDue ?? '—'} {d.reviewOverdue && <Badge variant="destructive">Overdue</Badge>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pager data={data} page={page} setPage={setPage} />
        </Card>
      </div>
    </>
  );
}

function NewDocument({ onDone }: { onDone: (id?: string) => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [chapter, setChapter] = React.useState<Q.NabhChapter | ''>('');
  const [docType, setDocType] = React.useState<Q.DocumentType | ''>('policy');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: Q.CreateDocument) => api.quality.documents.create(body),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'documents'] });
      onDone(d.id);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>New document</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            const body: Q.CreateDocument = { code, title, chapter: chapter as Q.NabhChapter, docType: docType as Q.DocumentType };
            const { errors: found } = validate(Q.createDocumentSchema, body);
            setErrors(found ?? {});
            if (!found) create.mutate(body);
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={Object.keys(errors).length ? 'Please correct the highlighted fields' : create.error} />
          </div>
          <Field id="d-code" label="Code *" hint="e.g. HIC-POL-01" error={errors.code}>
            <Input id="d-code" required maxLength={40} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field id="d-title" label="Title *" className="sm:col-span-3" error={errors.title}>
            <Input id="d-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="d-chapter" label="NABH chapter *" className="sm:col-span-2">
            <EnumSelect id="d-chapter" value={chapter} onChange={setChapter} options={CHAPTERS} labels={CHAPTER_LABELS} placeholder="Choose…" />
          </Field>
          <Field id="d-type" label="Type *">
            <EnumSelect id="d-type" value={docType} onChange={setDocType} options={Q.DOCUMENT_TYPES} />
          </Field>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" disabled={create.isPending || !chapter}>
              {create.isPending && <Loader2 className="animate-spin" />} Create draft
            </Button>
            <Button type="button" variant="ghost" onClick={() => onDone()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
