'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Send } from 'lucide-react';
import { integrations as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { type FieldErrors, validate } from '@/lib/validate';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, ErrorBox, Field, MessageRow, Pager, StatusBadge, formatDateTime, useDebounced } from '@/modules/integrations/ui';

const PAGE_SIZE = 25;
const ABNORMAL = new Set(['H', 'L', 'HH', 'LL', 'A', 'AA', '>', '<']);

interface Form {
  id?: string;
  code: string;
  name: string;
  model: string;
  protocol: I.DeviceProtocol;
  isActive: boolean;
}
const blank: Form = { code: '', name: '', model: '', protocol: 'hl7v2', isActive: true };

const hl7Stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function sampleMessage(device: I.LabDevice) {
  const now = new Date();
  const ts = hl7Stamp(now);
  const sample = `S${String(now.getTime()).slice(-5)}`;
  return [
    `MSH|^~\\&|${device.code}|LAB|HMS|HOSP|${ts}||ORU^R01|MSG${now.getTime()}|P|2.5.1`,
    'PID|1||UH000123||Sharma^Ravi',
    `OBR|1|${sample}|${sample}|CBC^Complete Blood Count`,
    `OBX|1|NM|HGB^Hemoglobin||13.5|g/dL|13.0-17.0|N|||F|||${ts}`,
    `OBX|2|NM|WBC^WBC Count||12.4|10*3/uL|4.0-11.0|H|||F|||${ts}`,
  ].join('\n');
}

export default function DevicesPage() {
  const canRead = usePermission('integrations.device.read');
  const canManage = usePermission('integrations.device.manage');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form | null>(null);
  const [testing, setTesting] = React.useState<{ device: I.LabDevice; message: string } | null>(null);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const [deviceId, setDeviceId] = React.useState('');
  const [status, setStatus] = React.useState<I.DeviceMessageStatus | 'all'>('all');
  const [sampleSearch, setSampleSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const sampleId = useDebounced(sampleSearch.trim());

  const devices = useQuery({ queryKey: ['integrations', 'devices', 'list'], queryFn: () => api.integrations.devices.list(), enabled: canRead });
  const msgQuery: I.DeviceMessageQuery = { deviceId: deviceId || undefined, status, sampleId: sampleId || undefined, page, pageSize: PAGE_SIZE };
  const messages = useQuery({
    queryKey: ['integrations', 'devices', 'messages', msgQuery],
    queryFn: () => api.integrations.devices.messages(msgQuery),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body = { name: f.name, model: f.model.trim() || undefined, protocol: f.protocol, isActive: f.isActive };
      return f.id ? api.integrations.devices.update(f.id, body) : api.integrations.devices.create({ ...body, code: f.code });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'devices'] });
    },
  });
  const test = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.integrations.devices.testMessage(id, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'devices'] }),
  });

  if (!canRead) return <NoAccess />;
  const deviceName = (id: string) => devices.data?.find((d) => d.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Lab machines"
        description="Analysers that send results over HL7 v2 (ORU^R01). Machines post to the public API with an API key that has the lab-results scope."
        actions={
          <Can permission="integrations.device.manage">
            <Button onClick={() => setForm({ ...blank })}>
              <Plus /> Add machine
            </Button>
          </Can>
        }
      />

      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.code}` : 'New lab machine'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const body = { name: form.name, model: form.model.trim() || undefined, protocol: form.protocol, isActive: form.isActive };
                const v = form.id ? validate(I.updateDeviceSchema, body) : validate(I.deviceInputSchema, { ...body, code: form.code });
                setErrors(v.errors ?? {});
                if (v.data) save.mutate(form);
              }}
            >
              <div className="sm:col-span-3">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
              </div>
              <Field id="code" label="Code *" hint="Must match MSH-3 (sending application) or the deviceCode the machine sends." error={errors.code}>
                <Input id="code" maxLength={30} value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. SYSMEX-XN" required />
              </Field>
              <Field id="name" label="Name *" error={errors.name}>
                <Input id="name" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Haematology analyser" required />
              </Field>
              <Field id="model" label="Model" error={errors.model}>
                <Input id="model" maxLength={100} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. Sysmex XN-1000" />
              </Field>
              <Field id="protocol" label="Protocol">
                <Select id="protocol" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as I.DeviceProtocol })}>
                  <option value="hl7v2">HL7 v2</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
              </label>
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <div className="border-b p-4">
          <h2 className="font-semibold">Machines</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.error ? (
              <MessageRow colSpan={6} error>
                {errorMessage(devices.error)}
              </MessageRow>
            ) : devices.isPending ? (
              <MessageRow colSpan={6}>Loading…</MessageRow>
            ) : devices.data.length === 0 ? (
              <MessageRow colSpan={6}>No lab machines yet.</MessageRow>
            ) : (
              devices.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  <TableCell className="font-medium">
                    {d.name} {!d.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell>{d.model ?? '—'}</TableCell>
                  <TableCell>HL7 v2</TableCell>
                  <TableCell className="text-xs">{formatDateTime(d.lastMessageAt)}</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            test.reset();
                            setTesting({ device: d, message: sampleMessage(d) });
                          }}
                        >
                          <Send /> Send test
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setForm({ id: d.id, code: d.code, name: d.name, model: d.model ?? '', protocol: d.protocol, isActive: d.isActive })}>
                          Edit
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <h2 className="mr-auto font-semibold">Message log</h2>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Sample id…"
              className="pl-9"
              value={sampleSearch}
              onChange={(e) => {
                setSampleSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="w-48"
            aria-label="Machine"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All machines</option>
            {devices.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </Select>
          <Select
            className="w-36"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Received</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sample</TableHead>
              <TableHead>Patient ref</TableHead>
              <TableHead className="text-right">Results</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.error ? (
              <MessageRow colSpan={8} error>
                {errorMessage(messages.error)}
              </MessageRow>
            ) : messages.isPending ? (
              <MessageRow colSpan={8}>Loading…</MessageRow>
            ) : messages.data.items.length === 0 ? (
              <MessageRow colSpan={8}>No messages.</MessageRow>
            ) : (
              messages.data.items.map((m) => {
                const abnormal = m.results.filter((r) => r.flag && ABNORMAL.has(r.flag.toUpperCase())).length;
                return (
                  <TableRow key={m.id} className="cursor-pointer" onClick={() => setViewing(m.id)}>
                    <TableCell className="text-xs">{formatDateTime(m.receivedAt)}</TableCell>
                    <TableCell>
                      {deviceName(m.deviceId) ?? m.deviceCode}
                      <span className="block font-mono text-xs text-muted-foreground">{m.deviceCode}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.messageType ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{m.sampleId ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{m.patientRef ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.results.length}
                      {abnormal > 0 && <span className="ml-1 text-xs font-medium text-destructive">({abnormal} abnormal)</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                      {m.error && <span className="block max-w-xs truncate text-xs text-destructive">{m.error}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {messages.data && <Pager page={page} pageSize={messages.data.pageSize} total={messages.data.total} onPage={setPage} />}
      </Card>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title="Lab machine message" wide>
        {viewing && <MessageDetail id={viewing} />}
      </Dialog>

      <Dialog open={!!testing} onClose={() => setTesting(null)} title={testing ? `Send test message to ${testing.device.code}` : 'Send test'} wide>
        {testing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              test.mutate({ id: testing.device.id, message: testing.message });
            }}
          >
            <p className="text-sm text-muted-foreground">
              The message goes through the same path a real machine uses. Each segment on its own line; MSH-10 (control id) must be unique.
            </p>
            <textarea
              aria-label="HL7 message"
              className="min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={testing.message}
              onChange={(e) => setTesting({ ...testing, message: e.target.value })}
              spellCheck={false}
            />
            <ErrorBox error={test.error ? errorMessage(test.error) : null} />
            {test.data && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={test.data.status} />
                  <span>
                    {test.data.resultCount} result{test.data.resultCount === 1 ? '' : 's'}
                  </span>
                  {test.data.duplicate && <Badge variant="secondary">Duplicate control id</Badge>}
                  {test.data.error && <span className="text-destructive">{test.data.error}</span>}
                </div>
                <p className="text-xs font-medium text-muted-foreground">ACK returned to the machine</p>
                <pre className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">{test.data.ack.replace(/\r/g, '\n')}</pre>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  test.reset();
                  setTesting({ ...testing, message: sampleMessage(testing.device) });
                }}
              >
                New sample (fresh control id)
              </Button>
              <Button type="submit" disabled={test.isPending || testing.message.trim().length < 10}>
                {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                Send
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

function MessageDetail({ id }: { id: string }) {
  const { data: m, isPending, error } = useQuery({ queryKey: ['integrations', 'devices', 'message', id], queryFn: () => api.integrations.devices.message(id) });
  if (error) return <ErrorBox error={errorMessage(error)} />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {(
          [
            ['Machine', m.deviceCode],
            ['Type', m.messageType ?? '—'],
            ['Control id', m.controlId ?? '—'],
            ['Received', formatDateTime(m.receivedAt)],
            ['Sample id', m.sampleId ?? '—'],
            ['Patient ref', m.patientRef ?? '—'],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <StatusBadge status={m.status} />
          </dd>
        </div>
      </dl>
      <ErrorBox error={m.error} />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Test</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Flag</TableHead>
              <TableHead>Observed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.results.length === 0 ? (
              <MessageRow colSpan={7}>No results parsed.</MessageRow>
            ) : (
              m.results.map((r, i) => {
                const abnormal = !!r.flag && ABNORMAL.has(r.flag.toUpperCase());
                return (
                  <TableRow key={`${r.code}-${i}`} className={abnormal ? 'bg-destructive/5' : undefined}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>{r.name ?? '—'}</TableCell>
                    <TableCell className={`text-right tabular-nums ${abnormal ? 'font-semibold text-destructive' : ''}`}>{r.value}</TableCell>
                    <TableCell>{r.unit ?? ''}</TableCell>
                    <TableCell className="text-xs">{r.referenceRange ?? '—'}</TableCell>
                    <TableCell>{r.flag ? <Badge variant={abnormal ? 'destructive' : 'secondary'}>{r.flag}</Badge> : '—'}</TableCell>
                    <TableCell className="text-xs">{r.observedAt ? formatDateTime(r.observedAt) : '—'}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Raw HL7</p>
        <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">{m.raw.replace(/\r\n?/g, '\n')}</pre>
      </div>
    </div>
  );
}
