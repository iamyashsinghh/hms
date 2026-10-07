'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, ShieldAlert, UserPlus } from 'lucide-react';
import type { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BED_STATUS_LABELS, BED_STATUS_STYLES, BedStatusDot, ErrorBox, WARD_TYPE_LABELS, daysLabel, formatINR } from '@/modules/ipd/ui';

const ORDER: I.BedStatus[] = ['available', 'occupied', 'cleaning', 'reserved', 'maintenance'];

const daysSince = (iso: string) => Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000) || 1);

export default function BedBoardPage() {
  const canRead = usePermission('ipd.ward.read');
  const canAdmit = usePermission('ipd.admission.create');
  const canHousekeep = usePermission('ipd.admission.transfer');
  const canManage = usePermission('ipd.ward.manage');
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<I.BedStatus | 'all'>('all');
  const { data, error, isLoading } = useQuery({ queryKey: ['ipd', 'bed-board'], queryFn: () => api.ipd.bedBoard(), enabled: canRead, refetchInterval: 30_000 });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: I.ManualBedStatus }) => api.ipd.beds.setStatus(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ipd'] }),
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Bed board"
        description="Every bed in this facility at a glance. Click an occupied bed to open the patient's chart."
        actions={
          canAdmit && (
            <Link href="/ipd/admit" className={buttonVariants()}>
              <UserPlus /> Admit patient
            </Link>
          )
        }
      />

      {data && (
        <div className="mb-6 flex flex-wrap gap-2">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All beds <span className="tabular-nums">{data.totals.total}</span>
          </FilterChip>
          {ORDER.map((s) => (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
              <BedStatusDot status={s} /> {BED_STATUS_LABELS[s]} <span className="tabular-nums">{data.totals[s]}</span>
            </FilterChip>
          ))}
          {data.totals.total > 0 && (
            <span className="ml-auto self-center text-sm text-muted-foreground">
              Occupancy {Math.round((data.totals.occupied / data.totals.total) * 100)}%
            </span>
          )}
        </div>
      )}

      <ErrorBox error={error ? errorMessage(error) : setStatus.error ? errorMessage(setStatus.error) : null} />
      {isLoading && <p className="text-sm text-muted-foreground">Loading beds…</p>}
      {data && data.wards.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BedDouble className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No wards yet. Add wards and beds to start admitting patients.</p>
            {canManage && (
              <Link href="/ipd/wards" className={buttonVariants({ variant: 'outline' })}>
                Set up wards & beds
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {data?.wards.map((w) => {
          const beds = w.beds.filter((b) => filter === 'all' || b.status === filter);
          if (!beds.length && filter !== 'all') return null;
          return (
            <Card key={w.id}>
              <CardHeader className="flex flex-row items-baseline justify-between gap-4">
                <CardTitle>
                  {w.name} <span className="text-sm font-normal text-muted-foreground">· {WARD_TYPE_LABELS[w.wardType]}{w.floor ? ` · Floor ${w.floor}` : ''}</span>
                </CardTitle>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {w.occupiedCount}/{w.bedCount} occupied
                </span>
              </CardHeader>
              <CardContent>
                {beds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No beds in this ward.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {beds.map((b) => (
                      <li key={b.id}>
                        <BedTile
                          bed={b}
                          canAdmit={canAdmit}
                          canHousekeep={canHousekeep}
                          busy={setStatus.isPending}
                          onStatus={(status) => setStatus.mutate({ id: b.id, status })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors', active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}
    >
      {children}
    </button>
  );
}

function BedTile({
  bed,
  canAdmit,
  canHousekeep,
  busy,
  onStatus,
}: {
  bed: I.Bed;
  canAdmit: boolean;
  canHousekeep: boolean;
  busy: boolean;
  onStatus: (s: I.ManualBedStatus) => void;
}) {
  const head = (
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold">{bed.code}</span>
      <span className="text-xs opacity-80">{bed.roomNo ? `Rm ${bed.roomNo}` : BED_STATUS_LABELS[bed.status]}</span>
    </div>
  );
  const base = cn('flex h-full min-h-28 flex-col gap-1 rounded-lg border p-3 text-sm', BED_STATUS_STYLES[bed.status]);

  if (bed.occupant) {
    const o = bed.occupant;
    return (
      <Link href={`/ipd/admissions/${o.admissionId}`} className={cn(base, 'transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
        {head}
        <span className="truncate font-medium" title={o.patientName}>
          {o.patientName}
        </span>
        <span className="font-mono text-xs opacity-80">{o.ipdNo}</span>
        <span className="mt-auto flex items-center justify-between text-xs opacity-80">
          <span className="truncate">{o.doctorName}</span>
          <span className="shrink-0">{daysLabel(daysSince(o.admittedAt))}</span>
        </span>
        {o.isMlc && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <ShieldAlert className="size-3" /> MLC
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className={base}>
      {head}
      <span className="text-xs opacity-80">{formatINR(bed.dailyRate)}/day</span>
      <div className="mt-auto flex flex-wrap gap-1">
        {(bed.status === 'available' || bed.status === 'reserved') && canAdmit && (
          <Link href={`/ipd/admit?bedId=${bed.id}`} className={buttonVariants({ size: 'sm', variant: 'outline', className: 'h-7 bg-background/70' })}>
            Admit
          </Link>
        )}
        {bed.status !== 'available' && canHousekeep && (
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onStatus('available')}>
            Mark ready
          </Button>
        )}
        {bed.status === 'available' && canHousekeep && (
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onStatus('cleaning')}>
            Cleaning
          </Button>
        )}
      </div>
    </div>
  );
}
