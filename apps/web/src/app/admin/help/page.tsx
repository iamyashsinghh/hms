'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox, MODULE_LABELS, dateTime, firstIssue } from '@/modules/platform/ui';

const LABELS: Record<string, string> = { slug: 'Slug', title: 'Title', summary: 'Summary', body: 'Article', sortOrder: 'Sort order', moduleKey: 'Module' };

/** New help article; with `initial` it edits that article. */
function HelpForm({ initial, onDone }: { initial?: platform.HelpArticle; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({
    slug: initial?.slug ?? '',
    title: initial?.title ?? '',
    moduleKey: initial?.moduleKey ?? '',
    summary: initial?.summary ?? '',
    body: initial?.body ?? '',
    sortOrder: String(initial?.sortOrder ?? 0),
    isPublished: initial?.isPublished ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        slug: f.slug,
        title: f.title,
        moduleKey: f.moduleKey || null,
        summary: f.summary,
        body: f.body,
        sortOrder: f.sortOrder.trim() === '' ? 0 : Number(f.sortOrder),
        isPublished: f.isPublished,
      };
      const problem = firstIssue(initial ? platform.updateHelpArticleSchema : platform.upsertHelpArticleSchema, body, LABELS);
      if (problem) throw new Error(problem);
      return initial ? consoleApi.updateHelp(initial.id, body) : consoleApi.createHelp(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'help'] });
      onDone();
    },
  });
  const id = (k: string) => `${initial?.id ?? 'new'}-${k}`;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{initial ? `Edit "${initial.title}"` : 'New help article'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor={id('title')}>Title *</Label>
            <Input id={id('title')} className="mt-1" maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={id('slug')}>Slug * (lowercase, digits, -)</Label>
            <Input id={id('slug')} className="mt-1 font-mono" maxLength={81} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="e.g. book-an-appointment" />
          </div>
          <div>
            <Label htmlFor={id('module')}>Module</Label>
            <Select id={id('module')} className="mt-1" value={f.moduleKey} onChange={(e) => setF({ ...f, moduleKey: e.target.value })}>
              <option value="">General</option>
              {platform.ENTITLEMENT_MODULES.map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m] ?? m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={id('sort')}>Sort order</Label>
            <Input id={id('sort')} className="mt-1" type="number" step={1} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} /> Published (visible to hospitals)
          </label>
          <div className="sm:col-span-4">
            <Label htmlFor={id('summary')}>Summary</Label>
            <Input id={id('summary')} className="mt-1" maxLength={300} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor={id('body')}>Article * (Markdown)</Label>
            <textarea
              id={id('body')}
              rows={10}
              maxLength={20000}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              value={f.body}
              onChange={(e) => setF({ ...f, body: e.target.value })}
            />
          </div>
        </div>
        <ErrorBox error={save.error} />
        <div className="flex gap-2">
          <Button disabled={save.isPending || f.title.trim().length < 3 || !f.slug.trim() || !f.body.trim()} onClick={() => save.mutate()}>
            {initial ? 'Save changes' : 'Create article'}
          </Button>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ConsoleHelpPage() {
  const list = useQuery({ queryKey: ['console', 'help'], queryFn: () => consoleApi.help() });
  const [editing, setEditing] = React.useState<platform.HelpArticle | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Help articles"
        description="The in-app help centre hospitals see. Unpublished articles stay hidden."
        actions={
          !adding && (
            <Button onClick={() => (setEditing(null), setAdding(true))}>
              <Plus /> New article
            </Button>
          )
        }
      />
      {adding && <HelpForm onDone={() => setAdding(false)} />}
      {editing && <HelpForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
      <ErrorBox error={list.error} />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Title</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.data?.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {list.isPending ? 'Loading…' : 'No help articles yet.'}
                </TableCell>
              </TableRow>
            ) : (
              list.data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <div className="font-medium">{h.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">{h.slug}</div>
                  </TableCell>
                  <TableCell>{h.moduleKey ? (MODULE_LABELS[h.moduleKey] ?? h.moduleKey) : 'General'}</TableCell>
                  <TableCell className="tabular-nums">{h.sortOrder}</TableCell>
                  <TableCell>{h.isPublished ? 'Published' : <span className="text-muted-foreground">Draft</span>}</TableCell>
                  <TableCell className="text-xs">{dateTime(h.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${h.title}`} onClick={() => (setAdding(false), setEditing(h))}>
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
