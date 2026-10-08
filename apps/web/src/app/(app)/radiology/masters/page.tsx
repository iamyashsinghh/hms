'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Sparkles } from 'lucide-react';
import { billing, radiology } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { BulkImportButton } from '@/components/bulk-import';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea, rupees } from '@/modules/radiology/ui';
import { cn } from '@/lib/utils';

type Tab = 'tests' | 'modalities' | 'templates';

/** A form-level message from checking the values with the shared schema before saving. */
function useCheck() {
  const [message, setMessage] = React.useState<string | null>(null);
  const check = (schema: Parameters<typeof validate>[0], values: unknown, extra?: string | null) => {
    const msg = firstError(validate(schema, values).errors) ?? extra ?? null;
    setMessage(msg);
    return !msg;
  };
  return { message, check };
}

function useSaver<T>(fn: (v: T) => Promise<unknown>, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['radiology'] });
      onDone();
    },
  });
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ---------- machines ----------

function ModalityForm({ initial, onDone }: { initial?: radiology.Modality; onDone: () => void }) {
  const [f, setF] = React.useState<radiology.ModalityInput>({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    kind: initial?.kind ?? 'XR',
    room: initial?.room ?? '',
    aeTitle: initial?.aeTitle ?? '',
    isActive: initial?.isActive ?? true,
  });
  const save = useSaver(() => (initial ? api.radiology.updateModality(initial.id, f) : api.radiology.createModality(f)), onDone);
  const { message, check } = useCheck();
  return (
    <form
      className="grid gap-3 border-b bg-muted/30 p-4 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (check(initial ? radiology.updateModalitySchema : radiology.modalityInputSchema, f)) save.mutate(undefined);
      }}
    >
      <Field label="Code"><Input maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="CT1" /></Field>
      <Field label="Name" className="sm:col-span-2"><Input maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="CT scanner 16 slice" /></Field>
      <Field label="Type">
        <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as radiology.ModalityInput['kind'] })}>
          {radiology.MODALITY_KINDS.map((k) => (
            <option key={k} value={k}>{radiology.MODALITY_KIND_LABELS[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Room"><Input maxLength={60} value={f.room ?? ''} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
      <Field label="PACS AE title"><Input maxLength={16} value={f.aeTitle ?? ''} onChange={(e) => setF({ ...f, aeTitle: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-6">
        <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> In use
      </label>
      <div className="flex items-center gap-2 sm:col-span-6">
        <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Close</Button>
        {(message || save.error) && <span className="text-sm text-destructive">{message ?? errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}

function Modalities({ canManage }: { canManage: boolean }) {
  const { data, error } = useQuery({ queryKey: ['radiology', 'modalities', 'all'], queryFn: () => api.radiology.modalities({ includeInactive: true }) });
  const [editing, setEditing] = React.useState<radiology.Modality | 'new' | null>(null);
  return (
    <Card>
      {canManage && (
        <div className="flex justify-end border-b p-3">
          <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add machine</Button>
        </div>
      )}
      {editing && <ModalityForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      {error && <p className="p-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Room</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-mono text-xs">{m.code}</TableCell>
              <TableCell>{m.name} {!m.isActive && <Badge variant="outline">Not in use</Badge>}</TableCell>
              <TableCell>{radiology.MODALITY_KIND_LABELS[m.kind]}</TableCell>
              <TableCell>{m.room ?? '—'}</TableCell>
              <TableCell className="text-right">
                {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label="Edit"><Pencil /></Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------- tests ----------

function TestForm({ initial, onDone }: { initial?: radiology.RadiologyTest; onDone: () => void }) {
  const modalities = useQuery({ queryKey: ['radiology', 'modalities'], queryFn: () => api.radiology.modalities() });
  const templates = useQuery({ queryKey: ['radiology', 'templates', 'all'], queryFn: () => api.radiology.templates() });
  const [f, setF] = React.useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    modalityId: initial?.modalityId ?? '',
    bodyPart: initial?.bodyPart ?? '',
    serviceCode: initial?.serviceCode ?? '',
    price: initial?.price != null ? String(initial.price) : '',
    taxRate: String(initial?.taxRate ?? 0),
    durationMinutes: String(initial?.durationMinutes ?? 15),
    contrast: initial?.contrast ?? false,
    preparation: initial?.preparation ?? '',
    defaultTemplateId: initial?.defaultTemplateId ?? '',
    isActive: initial?.isActive ?? true,
  });
  const body = (): radiology.TestInput => ({
    ...f,
    price: f.price === '' ? undefined : Number(f.price),
    taxRate: Number(f.taxRate),
    durationMinutes: Number(f.durationMinutes),
    defaultTemplateId: f.defaultTemplateId || null,
  });
  const save = useSaver(() => (initial ? api.radiology.updateTest(initial.id, body()) : api.radiology.createTest(body())), onDone);
  const { message, check } = useCheck();
  return (
    <form
      className="grid gap-3 border-b bg-muted/30 p-4 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const noPrice = !f.serviceCode.trim() && f.price.trim() === '' ? 'Give a price or a billing service code' : null;
        if (check(initial ? radiology.updateTestSchema : radiology.testInputSchema, body(), noPrice)) save.mutate(undefined);
      }}
    >
      <Field label="Code"><Input maxLength={30} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="USG-ABD" /></Field>
      <Field label="Name" className="sm:col-span-3"><Input maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="USG whole abdomen" /></Field>
      <Field label="Machine" className="sm:col-span-2">
        <Select value={f.modalityId} onChange={(e) => setF({ ...f, modalityId: e.target.value })}>
          <option value="">Pick</option>
          {modalities.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Field label="Price (₹)"><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
      <Field label="GST %">
        <Select value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })}>
          {billing.GST_RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
        </Select>
      </Field>
      <Field label="Or billing service code"><Input value={f.serviceCode} onChange={(e) => setF({ ...f, serviceCode: e.target.value })} /></Field>
      <Field label="Slot (minutes)"><Input inputMode="numeric" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
      <Field label="Body part"><Input value={f.bodyPart} onChange={(e) => setF({ ...f, bodyPart: e.target.value })} /></Field>
      <Field label="Default template">
        <Select value={f.defaultTemplateId} onChange={(e) => setF({ ...f, defaultTemplateId: e.target.value })}>
          <option value="">None</option>
          {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <Field label="Patient preparation" className="sm:col-span-6"><Input maxLength={500} value={f.preparation} onChange={(e) => setF({ ...f, preparation: e.target.value })} placeholder="6 hours fasting" /></Field>
      <div className="flex flex-wrap gap-4 text-sm sm:col-span-6">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.contrast} onChange={(e) => setF({ ...f, contrast: e.target.checked })} /> With contrast</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> In use</label>
      </div>
      <div className="flex items-center gap-2 sm:col-span-6">
        <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Close</Button>
        {(message || save.error) && <span className="text-sm text-destructive">{message ?? errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}

function Tests({ canManage }: { canManage: boolean }) {
  const [q, setQ] = React.useState('');
  const { data, error } = useQuery({ queryKey: ['radiology', 'tests', 'all', q], queryFn: () => api.radiology.tests({ q: q || undefined, includeInactive: true }) });
  const [editing, setEditing] = React.useState<radiology.RadiologyTest | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <Input type="search" className="max-w-xs" placeholder="Search tests" value={q} onChange={(e) => setQ(e.target.value)} />
        {canManage && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add test</Button>}
      </div>
      {editing && <TestForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      {error && <p className="p-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Test</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Slot</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono text-xs">{t.code}</TableCell>
              <TableCell>
                {t.name} {t.contrast && <Badge variant="secondary">Contrast</Badge>} {!t.isActive && <Badge variant="outline">Not in use</Badge>}
                {t.preparation && <div className="text-xs text-muted-foreground">{t.preparation}</div>}
              </TableCell>
              <TableCell>{t.modalityName}</TableCell>
              <TableCell>{t.serviceCode ? <span className="font-mono text-xs">{t.serviceCode}</span> : rupees(t.price)}</TableCell>
              <TableCell>{t.durationMinutes} min</TableCell>
              <TableCell className="text-right">
                {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label="Edit"><Pencil /></Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------- templates ----------

function TemplateForm({ initial, onDone }: { initial?: radiology.ReportTemplate; onDone: () => void }) {
  const modalities = useQuery({ queryKey: ['radiology', 'modalities'], queryFn: () => api.radiology.modalities() });
  const [f, setF] = React.useState({
    name: initial?.name ?? '',
    modalityId: initial?.modalityId ?? '',
    technique: initial?.technique ?? '',
    findings: initial?.findings ?? '',
    impression: initial?.impression ?? '',
    isActive: initial?.isActive ?? true,
  });
  const body = (): radiology.TemplateInput => ({ ...f, modalityId: f.modalityId || null });
  const save = useSaver(() => (initial ? api.radiology.updateTemplate(initial.id, body()) : api.radiology.createTemplate(body())), onDone);
  const { message, check } = useCheck();
  return (
    <form
      className="grid gap-3 border-b bg-muted/30 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (check(initial ? radiology.updateTemplateSchema : radiology.templateInputSchema, body())) save.mutate(undefined);
      }}
    >
      <Field label="Name"><Input maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="USG abdomen normal" /></Field>
      <Field label="Machine">
        <Select value={f.modalityId} onChange={(e) => setF({ ...f, modalityId: e.target.value })}>
          <option value="">Any machine</option>
          {modalities.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Field label="Technique" className="sm:col-span-2"><Textarea rows={2} value={f.technique} onChange={(e) => setF({ ...f, technique: e.target.value })} /></Field>
      <Field label="Findings" className="sm:col-span-2"><Textarea rows={10} className="font-mono text-[13px]" value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
      <Field label="Impression" className="sm:col-span-2"><Textarea rows={2} value={f.impression} onChange={(e) => setF({ ...f, impression: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> In use
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Close</Button>
        {(message || save.error) && <span className="text-sm text-destructive">{message ?? errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}

function Templates({ canManage }: { canManage: boolean }) {
  const { data, error } = useQuery({ queryKey: ['radiology', 'templates', 'manage'], queryFn: () => api.radiology.templates({ includeInactive: true }) });
  const modalities = useQuery({ queryKey: ['radiology', 'modalities', 'all'], queryFn: () => api.radiology.modalities({ includeInactive: true }) });
  const name = new Map(modalities.data?.map((m) => [m.id, m.name]));
  const [editing, setEditing] = React.useState<radiology.ReportTemplate | 'new' | null>(null);
  return (
    <Card>
      {canManage && (
        <div className="flex justify-end border-b p-3">
          <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add template</Button>
        </div>
      )}
      {editing && <TemplateForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      {error && <p className="p-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead>Impression</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.name} {!t.isActive && <Badge variant="outline">Not in use</Badge>}</TableCell>
              <TableCell>{t.modalityId ? (name.get(t.modalityId) ?? '—') : 'Any'}</TableCell>
              <TableCell className="max-w-md truncate text-sm text-muted-foreground">{t.impression ?? '—'}</TableCell>
              <TableCell className="text-right">
                {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label="Edit"><Pencil /></Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function RadiologyMastersPage() {
  const canRead = usePermission('radiology.master.read');
  const canManage = usePermission('radiology.master.manage');
  const [tab, setTab] = React.useState<Tab>('tests');
  const qc = useQueryClient();
  const starter = useMutation({
    mutationFn: () => api.radiology.loadStarterMasters(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['radiology'] }),
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Radiology masters"
        description="Machines, the tests you offer with prices and slot length, and report templates."
        actions={
          canManage && (
            <>
              <BulkImportButton
                buttonLabel="Import tests from Excel"
                noun="radiology tests"
                columns={radiology.TEST_IMPORT_COLUMNS}
                run={(req) => api.radiology.importTests(req)}
                invalidate={[['radiology']]}
              />
              <Button variant="outline" disabled={starter.isPending} onClick={() => starter.mutate()}>
                {starter.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Load common tests
              </Button>
            </>
          )
        }
      />
      {starter.data && (
        <p className="mb-3 text-sm text-muted-foreground">
          Added {starter.data.modalities} machines, {starter.data.tests} tests and {starter.data.templates} templates. Edit prices to match your rates.
        </p>
      )}
      {starter.error && <p className="mb-3 text-sm text-destructive">{errorMessage(starter.error)}</p>}
      <div className="mb-4 flex gap-2">
        {(
          [
            ['tests', 'Tests'],
            ['modalities', 'Machines'],
            ['templates', 'Report templates'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn(buttonVariants({ variant: tab === key ? 'default' : 'outline', size: 'sm' }))}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'tests' && <Tests canManage={canManage} />}
      {tab === 'modalities' && <Modalities canManage={canManage} />}
      {tab === 'templates' && <Templates canManage={canManage} />}
    </>
  );
}
