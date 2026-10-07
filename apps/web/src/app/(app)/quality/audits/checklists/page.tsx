'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pencil, Plus } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EnumSelect, ErrorBox, Field, Textarea, humanize } from '@/modules/quality/ui';

const HAND_HYGIENE_TEMPLATE = [
  'Hand hygiene before touching a patient',
  'Hand hygiene before a clean / aseptic procedure',
  'Hand hygiene after body fluid exposure risk',
  'Hand hygiene after touching a patient',
  'Hand hygiene after touching patient surroundings',
  'Alcohol hand rub available at point of care',
  'Nails short, no jewellery or watches',
].join('\n');

export default function ChecklistsPage() {
  const can = usePermission('quality.audit.read');
  const canManage = usePermission('quality.checklist.manage');
  const { data, isPending, error } = useQuery({ queryKey: ['quality', 'checklists', true], queryFn: () => api.quality.checklists.list(true), enabled: can });
  const [editing, setEditing] = React.useState<Q.Checklist | 'new' | null>(null);
  if (!can) return <NoAccess />;
  return (
    <div className="space-y-6">
      <Link href="/quality/audits" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Audits
      </Link>
      <PageHeader
        title="Audit checklists"
        description="Edits apply to future audits; completed audits keep the checklist as it was."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New checklist
            </Button>
          )
        }
      />
      {editing && <Editor key={editing === 'new' ? 'new' : editing.id} checklist={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">No checklists yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>{c.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {humanize(c.category)} · {c.items.length} items {!c.isActive && <Badge variant="outline">Inactive</Badge>}
                  </p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {c.items.map((i) => (
                    <li key={i.id}>{i.text}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Editor({ checklist, onDone }: { checklist: Q.Checklist | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(checklist?.name ?? '');
  const [category, setCategory] = React.useState<Q.ChecklistCategory | ''>(checklist?.category ?? 'hand_hygiene');
  const [items, setItems] = React.useState(checklist ? checklist.items.map((i) => i.text).join('\n') : HAND_HYGIENE_TEMPLATE);
  const [isActive, setIsActive] = React.useState(checklist?.isActive ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        category: category as Q.ChecklistCategory,
        items: items
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        isActive,
      };
      return checklist ? api.quality.checklists.update(checklist.id, body) : api.quality.checklists.create(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'checklists'] });
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{checklist ? `Edit ${checklist.name}` : 'New checklist'}</CardTitle>
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
          <Field id="cl-name" label="Name *">
            <Input id="cl-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="cl-category" label="Category *">
            <EnumSelect id="cl-category" value={category} onChange={setCategory} options={Q.CHECKLIST_CATEGORIES} />
          </Field>
          <Field id="cl-items" label="Items * (one per line)" className="sm:col-span-2">
            <Textarea id="cl-items" rows={9} required value={items} onChange={(e) => setItems(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> In use
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save checklist
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
