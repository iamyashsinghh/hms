'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function FavouritesPage() {
  const canWrite = usePermission('emr.prescription.write');
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['emr', 'favourites'], queryFn: () => api.emr.favourites(), enabled: canWrite });
  const remove = useMutation({
    mutationFn: (id: string) => api.emr.deleteFavourite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr', 'favourites'] }),
  });

  if (!canWrite) return <NoAccess />;
  return (
    <>
      <PageHeader title="Rx favourites" description="Save a set of medicines from any prescription with “Save as favourite”, then add it in one click." />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favourites yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((f) => (
            <Card key={f.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">{f.name}</CardTitle>
                <Button size="icon" variant="ghost" aria-label="Delete" disabled={remove.isPending} onClick={() => window.confirm(`Delete “${f.name}”?`) && remove.mutate(f.id)}>
                  <Trash2 />
                </Button>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {f.lines.map((l, i) => (
                    <li key={i}>
                      <span className="font-medium">{l.drugName}</span> — {l.dose} {l.frequency}
                      {l.days ? ` × ${l.days}d` : ''}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
