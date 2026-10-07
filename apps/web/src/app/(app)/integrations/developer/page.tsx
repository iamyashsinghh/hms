'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, RotateCw, Send, TriangleAlert, Webhook } from 'lucide-react';
import { integrations as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckboxGroup, CopyBox, Dialog, ErrorBox, Field, MessageRow, Pager, StatusBadge, formatDateTime } from '@/modules/integrations/ui';

const PAGE_SIZE = 25;

function SecretOnce({ title, value, onDone, children }: { title: string; value: string; onDone: () => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <TriangleAlert className="size-4 text-amber-600" /> {title}
      </p>
      <p className="text-sm text-muted-foreground">Copy it now and store it safely. It will not be shown again.</p>
      <CopyBox value={value} />
      {children}
      <Button variant="outline" size="sm" onClick={onDone}>
        I have saved it
      </Button>
    </div>
  );
}

// ---------------- API keys ----------------

function ApiKeys() {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<{ name: string; scopes: I.ApiScope[]; expires: string } | null>(null);
  const [created, setCreated] = React.useState<I.CreatedApiKey | null>(null);
  const [now] = React.useState(() => Date.now());
  const [origin] = React.useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const { data, isPending, error } = useQuery({ queryKey: ['integrations', 'api-keys'], queryFn: () => api.integrations.apiKeys.list() });
  const create = useMutation({
    mutationFn: (f: NonNullable<typeof form>) =>
      api.integrations.apiKeys.create({
        name: f.name.trim(),
        scopes: f.scopes,
        expiresAt: f.expires ? new Date(`${f.expires}T23:59:59+05:30`).toISOString() : undefined,
      }),
    onSuccess: (k) => {
      setCreated(k);
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'api-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.integrations.apiKeys.revoke(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'api-keys'] }),
  });

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> API keys
          </CardTitle>
          <CardDescription>For lab machines, partner apps and other systems calling the public API.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreated(null);
            setForm({ name: '', scopes: [], expires: '' });
          }}
        >
          <Plus /> New key
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {created && (
          <SecretOnce title={`API key "${created.name}" created`} value={created.key} onDone={() => setCreated(null)}>
            <div className="text-sm">
              <p className="mb-1 text-muted-foreground">Test it:</p>
              <CopyBox value={`curl -H "x-api-key: ${created.key}" ${origin}/api/v1/integrations/public/v1/ping`} />
            </div>
          </SecretOnce>
        )}

        {form && (
          <form
            className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(form);
            }}
          >
            <div className="sm:col-span-2">
              <ErrorBox error={create.error ? errorMessage(create.error) : null} />
            </div>
            <Field id="key-name" label="Name *">
              <Input id="key-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sysmex analyser" required minLength={2} />
            </Field>
            <Field id="key-expires" label="Expires on" hint="Leave blank for no expiry.">
              <Input id="key-expires" type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
            </Field>
            <Field label="Scopes *" className="sm:col-span-2">
              <CheckboxGroup options={I.API_SCOPES} value={form.scopes} onChange={(scopes) => setForm({ ...form, scopes })} labels={I.API_SCOPE_LABELS} className="grid gap-2" />
            </Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.name.trim().length < 2 || form.scopes.length === 0 || create.isPending}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Create key
              </Button>
            </div>
          </form>
        )}

        <ErrorBox error={revoke.error ? errorMessage(revoke.error) : null} />
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <MessageRow colSpan={7} error>
                  {errorMessage(error)}
                </MessageRow>
              ) : isPending ? (
                <MessageRow colSpan={7}>Loading…</MessageRow>
              ) : data.length === 0 ? (
                <MessageRow colSpan={7}>No API keys yet.</MessageRow>
              ) : (
                data.map((k) => {
                  const expired = !!k.expiresAt && new Date(k.expiresAt).getTime() < now;
                  return (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <Badge key={s} variant="secondary" title={I.API_SCOPE_LABELS[s]}>
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(k.lastUsedAt)}</TableCell>
                      <TableCell className="text-xs">{k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</TableCell>
                      <TableCell>
                        {k.revokedAt ? <StatusBadge status="revoked" /> : expired ? <StatusBadge status="expired" /> : <StatusBadge status="active" />}
                      </TableCell>
                      <TableCell className="text-right">
                        {!k.revokedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revoke.isPending && revoke.variables === k.id}
                            onClick={() => {
                              if (window.confirm(`Revoke "${k.name}"? Systems using it will stop working immediately.`)) revoke.mutate(k.id);
                            }}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Send the key in the <code className="font-mono">x-api-key</code> header, e.g.{' '}
          <code className="break-all font-mono">curl -H &quot;x-api-key: &lt;key&gt;&quot; {origin}/api/v1/integrations/public/v1/ping</code>
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------- Webhooks ----------------

interface EndpointForm {
  id?: string;
  url: string;
  description: string;
  events: I.WebhookEvent[];
  isActive: boolean;
}

function Webhooks() {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<EndpointForm | null>(null);
  const [secret, setSecret] = React.useState<{ url: string; secret: string } | null>(null);
  const [endpointFilter, setEndpointFilter] = React.useState('');
  const [status, setStatus] = React.useState<I.WebhookDeliveryStatus | 'all'>('all');
  const [page, setPage] = React.useState(1);
  const [viewing, setViewing] = React.useState<I.WebhookDelivery | null>(null);

  const endpoints = useQuery({ queryKey: ['integrations', 'webhooks', 'endpoints'], queryFn: () => api.integrations.webhooks.list() });
  const dq: I.WebhookDeliveryQuery = { endpointId: endpointFilter || undefined, status, page, pageSize: PAGE_SIZE };
  const deliveries = useQuery({
    queryKey: ['integrations', 'webhooks', 'deliveries', dq],
    queryFn: () => api.integrations.webhooks.deliveries(dq),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['integrations', 'webhooks'] });

  const save = useMutation({
    mutationFn: (f: EndpointForm) => {
      const body: I.WebhookEndpointInput = { url: f.url.trim(), description: f.description.trim() || undefined, events: f.events, isActive: f.isActive };
      return f.id ? api.integrations.webhooks.update(f.id, body) : api.integrations.webhooks.create(body);
    },
    onSuccess: (ep) => {
      if (ep.secret) setSecret({ url: ep.url, secret: ep.secret });
      setForm(null);
      invalidate();
    },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.integrations.webhooks.rotateSecret(id),
    onSuccess: (ep) => {
      if (ep.secret) setSecret({ url: ep.url, secret: ep.secret });
      invalidate();
    },
  });
  const sendTest = useMutation({ mutationFn: (id: string) => api.integrations.webhooks.test(id), onSettled: invalidate });
  const retry = useMutation({ mutationFn: (id: string) => api.integrations.webhooks.retry(id), onSettled: invalidate });

  const endpointUrl = (id: string) => endpoints.data?.find((e) => e.id === id)?.url ?? id.slice(0, 8);
  const actionError = rotate.error ?? sendTest.error ?? retry.error;

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Webhook className="size-4" /> Webhook endpoints
            </CardTitle>
            <CardDescription>
              We POST JSON to these URLs when events happen. Each request is signed with the endpoint secret (HMAC-SHA256) so the receiver can verify it.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              save.reset();
              setForm({ url: '', description: '', events: [], isActive: true });
            }}
          >
            <Plus /> Add endpoint
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {secret && <SecretOnce title={`Signing secret for ${secret.url}`} value={secret.secret} onDone={() => setSecret(null)} />}
          {sendTest.data && (
            <p className="text-sm">
              Test event queued: <StatusBadge status={sendTest.data.status} />
              {sendTest.data.dryRun && (
                <Badge variant="outline" className="ml-2">
                  dry run: not actually sent
                </Badge>
              )}
            </p>
          )}
          <ErrorBox error={actionError ? errorMessage(actionError) : null} />

          {form && (
            <form
              className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <div className="sm:col-span-2">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
              </div>
              <Field id="wh-url" label="URL *" hint="Must use https (http allowed only for localhost).">
                <Input id="wh-url" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hms-webhook" required />
              </Field>
              <Field id="wh-desc" label="Description">
                <Input id="wh-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <Field label="Events *" className="sm:col-span-2">
                <CheckboxGroup options={I.WEBHOOK_EVENTS} value={form.events} onChange={(events) => setForm({ ...form, events })} className="grid gap-2 font-mono text-xs sm:grid-cols-2" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!form.url.trim() || form.events.length === 0 || save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Secret</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.error ? (
                  <MessageRow colSpan={5} error>
                    {errorMessage(endpoints.error)}
                  </MessageRow>
                ) : endpoints.isPending ? (
                  <MessageRow colSpan={5}>Loading…</MessageRow>
                ) : endpoints.data.length === 0 ? (
                  <MessageRow colSpan={5}>No webhook endpoints.</MessageRow>
                ) : (
                  endpoints.data.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell>
                        <span className="break-all font-mono text-xs">{ep.url}</span>
                        {ep.description && <span className="block text-xs text-muted-foreground">{ep.description}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-sm flex-wrap gap-1">
                          {ep.events.map((ev) => (
                            <Badge key={ev} variant="secondary" className="font-mono">
                              {ev}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{ep.secretHint}</TableCell>
                      <TableCell>{ep.isActive ? <StatusBadge status="active" /> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={sendTest.isPending && sendTest.variables === ep.id} onClick={() => sendTest.mutate(ep.id)}>
                            <Send /> Test
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={rotate.isPending && rotate.variables === ep.id}
                            onClick={() => {
                              if (window.confirm('Rotate the signing secret? The receiver must be updated with the new secret.')) rotate.mutate(ep.id);
                            }}
                          >
                            <RotateCw /> Rotate secret
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              save.reset();
                              setForm({ id: ep.id, url: ep.url, description: ep.description ?? '', events: ep.events, isActive: ep.isActive });
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <h2 className="mr-auto font-semibold">Deliveries</h2>
          <Select
            className="w-64"
            aria-label="Endpoint"
            value={endpointFilter}
            onChange={(e) => {
              setEndpointFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All endpoints</option>
            {endpoints.data?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.url}
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
            <option value="pending">Pending</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Created</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead>Response</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.error ? (
              <MessageRow colSpan={7} error>
                {errorMessage(deliveries.error)}
              </MessageRow>
            ) : deliveries.isPending ? (
              <MessageRow colSpan={7}>Loading…</MessageRow>
            ) : deliveries.data.items.length === 0 ? (
              <MessageRow colSpan={7}>No deliveries yet.</MessageRow>
            ) : (
              deliveries.data.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{formatDateTime(d.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{d.topic}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs">{endpointUrl(d.endpointId)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={d.status} />
                      {d.dryRun && (
                        <Badge variant="outline" title="The server is in dry-run mode and did not actually send this request">
                          dry run: not actually sent
                        </Badge>
                      )}
                    </div>
                    {d.lastError && <span className="block max-w-xs truncate text-xs text-destructive">{d.lastError}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                  <TableCell className="font-mono text-xs">{d.responseStatus ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(d)}>
                        Payload
                      </Button>
                      {d.status === 'failed' && (
                        <Button variant="ghost" size="sm" disabled={retry.isPending && retry.variables === d.id} onClick={() => retry.mutate(d.id)}>
                          {retry.isPending && retry.variables === d.id ? <Loader2 className="animate-spin" /> : <RotateCw />} Retry
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {deliveries.data && <Pager page={page} pageSize={deliveries.data.pageSize} total={deliveries.data.total} onPage={setPage} />}
      </Card>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `Delivery: ${viewing.topic}` : 'Delivery'} wide>
        {viewing && (
          <div className="space-y-3 text-sm">
            <p>
              Event id <span className="font-mono text-xs">{viewing.eventId}</span> · delivered {formatDateTime(viewing.deliveredAt)}
            </p>
            {viewing.lastError && <ErrorBox error={viewing.lastError} />}
            <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">{JSON.stringify(viewing.payload, null, 2)}</pre>
          </div>
        )}
      </Dialog>
    </>
  );
}

export default function DeveloperPage() {
  const canManage = usePermission('integrations.developer.manage');
  if (!canManage) return <NoAccess />;
  return (
    <>
      <PageHeader title="Developer" description="Public API keys and outbound webhooks for connecting third-party systems." />
      <ApiKeys />
      <Webhooks />
    </>
  );
}

