'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FileStack } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PAYER_TYPE_LABELS, formatINR, statusLabel } from '@/modules/insurance/ui';

export default function InsuranceDeskPage() {
  const canRead = usePermission('insurance.claim.read');
  const canReport = usePermission('insurance.report.read');
  const canPreauths = usePermission('insurance.preauth.read');
  const { data, error, isPending } = useQuery({ queryKey: ['insurance', 'summary'], queryFn: () => api.insurance.summary(), enabled: canReport });
  const queries = useQuery({
    queryKey: ['insurance', 'claims', { status: 'query' }],
    queryFn: () => api.insurance.claims.list({ status: 'query', pageSize: 10 }),
    enabled: canRead,
  });
  const pendingPa = useQuery({
    queryKey: ['insurance', 'preauths', { status: 'submitted' }],
    queryFn: () => api.insurance.preauths.list({ status: 'submitted', pageSize: 10 }),
    enabled: canPreauths,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Insurance desk"
        description="Pre-authorisations, claims and what insurers, TPAs, corporates and schemes owe the hospital."
        actions={
          <>
            <Can permission="insurance.preauth.manage">
              <Link href="/insurance/preauths/new" className={buttonVariants({ variant: 'outline' })}>
                <FilePlus2 /> New pre-auth
              </Link>
            </Can>
            <Can permission="insurance.claim.manage">
              <Link href="/insurance/claims/new" className={buttonVariants()}>
                <FileStack /> New claim
              </Link>
            </Can>
          </>
        }
      />

      {canReport && (
        <>
          {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Receivable from payers" value={isPending ? '…' : formatINR(data?.outstanding)} />
            <Stat label="Overdue" value={isPending ? '…' : formatINR(data?.overdue)} tone={data && data.overdue > 0 ? 'bad' : undefined} />
            <Stat label="Settled this month" value={isPending ? '…' : formatINR(data?.settledThisMonth)} />
            <Stat label="Deductions this month" value={isPending ? '…' : formatINR(data?.deductionsThisMonth)} />
          </div>
          {data && (
            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Claims by status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {I.CLAIM_STATUSES.map((s) => (
                    <Link key={s} href={`/insurance/claims?status=${s}`} className="flex justify-between rounded px-2 py-1 hover:bg-muted">
                      <span>{statusLabel(s)}</span>
                      <span className="tabular-nums">{data.claims[s]}</span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Receivables by payer</CardTitle>
                  <CardDescription>Age is counted from the day the claim was submitted.</CardDescription>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Payer</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">0–30 d</TableHead>
                      <TableHead className="text-right">31–60 d</TableHead>
                      <TableHead className="text-right">61–90 d</TableHead>
                      <TableHead className="text-right">90+ d</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byPayer.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                          Nothing outstanding.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.byPayer.map((p) => (
                        <TableRow key={p.payerId}>
                          <TableCell>
                            <Link href={`/insurance/claims?payerId=${p.payerId}&open=true`} className="font-medium hover:underline">
                              {p.payerName}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {PAYER_TYPE_LABELS[p.payerType]}
                              {p.creditLimit != null && p.outstanding > p.creditLimit && <span className="text-destructive"> · over credit limit</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{p.openClaims}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(p.ageing.d0_30)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(p.ageing.d31_60)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(p.ageing.d61_90)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(p.ageing.d90_plus)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatINR(p.outstanding)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkList
          title="Claims with a payer query"
          empty="No open queries."
          rows={(queries.data?.items ?? []).map((c) => ({ id: c.id, href: `/insurance/claims/${c.id}`, number: c.number, who: c.patientName, payer: c.payerName, amount: c.claimedAmount }))}
        />
        <WorkList
          title="Pre-auths waiting for the payer"
          empty="No pre-auths waiting."
          rows={(pendingPa.data?.items ?? []).map((p) => ({ id: p.id, href: `/insurance/preauths/${p.id}`, number: p.number, who: p.patientName, payer: p.payerName, amount: p.requestedAmount }))}
        />
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function WorkList({ title, empty, rows }: { title: string; empty: string; rows: { id: string; href: string; number: string; who: string; payer: string; amount: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={r.href} className="flex items-center justify-between gap-3 py-2 hover:underline">
                  <span>
                    <span className="font-mono text-xs">{r.number}</span> {r.who} <span className="text-muted-foreground">· {r.payer}</span>
                  </span>
                  <span className="tabular-nums">{formatINR(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
