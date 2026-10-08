'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { emr as E, type emr } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TIMING_LABEL } from '@/modules/emr/ui';

type Line = emr.Favourite['lines'][number];
interface LineDraft {
  key: number;
  drugName: string;
  dose: string;
  frequency: string;
  days: string;
  qty: string;
  route: string;
  timing: string;
  instructions: string;
  /** Fields the editor does not show (item code, strength…) are kept as they were. */
  rest: Partial<Line>;
}

let nextKey = 0;
const toDraft = (l: Partial<Line> = {}): LineDraft => {
  const { drugName, dose, frequency, days, qty, route, timing, instructions, ...rest } = l;
  return {
    key: nextKey++,
    drugName: drugName ?? '',
    dose: dose ?? '',
    frequency: frequency ?? '',
    days: days == null ? '' : String(days),
    qty: qty == null ? '' : String(qty),
    route: route ?? 'oral',
    timing: timing ?? 'any',
    instructions: instructions ?? '',
    rest,
  };
};
const fromDraft = (d: LineDraft): Line =>
  Object.fromEntries(
    Object.entries({
      ...d.rest,
      drugName: d.drugName.trim(),
      dose: d.dose.trim(),
      frequency: d.frequency.trim(),
      days: d.days === '' ? undefined : Number(d.days),
      qty: d.qty === '' ? undefined : Number(d.qty),
      route: d.route,
      timing: d.timing,
      instructions: d.instructions.trim() || undefined,
    }).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Line;

export default function FavouritesPage() {
  const canWrite = usePermission('emr.prescription.write');
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<string | null>(null);
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
      {remove.error && <p className="text-sm text-destructive">{errorMessage(remove.error)}</p>}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favourites yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((f) =>
            editing === f.id ? (
              <FavouriteEditor key={f.id} favourite={f} onDone={() => setEditing(null)} />
            ) : (
              <Card key={f.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{f.name}</CardTitle>
                  <div className="flex">
                    <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(f.id)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete"
                      disabled={remove.isPending}
                      onClick={() => window.confirm(`Delete “${f.name}”?`) && remove.mutate(f.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
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
            ),
          )}
        </div>
      )}
    </>
  );
}

function FavouriteEditor({ favourite, onDone }: { favourite: emr.Favourite; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(favourite.name);
  const [lines, setLines] = React.useState<LineDraft[]>(() => favourite.lines.map((l) => toDraft(l)));
  const [formError, setFormError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: emr.UpdateFavourite) => api.emr.updateFavourite(favourite.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['emr', 'favourites'] });
      onDone();
    },
  });
  const set = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), lines: lines.filter((l) => l.drugName.trim()).map(fromDraft) };
    const parsed = E.updateFavouriteSchema.safeParse(body);
    if (!body.lines.length) return setFormError('Keep at least one medicine (or delete the favourite)');
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const [field, index, key] = issue.path;
      return setFormError(
        field === 'lines' && typeof index === 'number' ? `Medicine ${index + 1}${key ? ` (${String(key)})` : ''}: ${issue.message}` : issue.message,
      );
    }
    setFormError(null);
    save.mutate(body);
  };

  return (
    <Card className="md:col-span-2 xl:col-span-3">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Edit favourite</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" noValidate onSubmit={submit}>
          <div className="max-w-sm">
            <Label htmlFor={`fav-name-${favourite.id}`}>Name</Label>
            <Input id={`fav-name-${favourite.id}`} className="mt-1.5" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12">
              <Input
                className="sm:col-span-4"
                aria-label="Medicine"
                placeholder="Medicine"
                maxLength={200}
                value={l.drugName}
                onChange={(e) => set(i, { drugName: e.target.value })}
              />
              <Input
                className="sm:col-span-2"
                aria-label="Dose"
                placeholder="Dose"
                maxLength={50}
                value={l.dose}
                onChange={(e) => set(i, { dose: e.target.value })}
              />
              <Input
                className="sm:col-span-2"
                aria-label="Frequency"
                list="fav-frequencies"
                placeholder="1-0-1 / BD"
                maxLength={30}
                value={l.frequency}
                onChange={(e) => set(i, { frequency: e.target.value })}
              />
              <Input
                className="sm:col-span-1"
                aria-label="Days"
                type="number"
                min={0}
                max={365}
                placeholder="Days"
                value={l.days}
                onChange={(e) => set(i, { days: e.target.value })}
              />
              <Input
                className="sm:col-span-1"
                aria-label="Qty"
                type="number"
                min={0}
                placeholder="Qty"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
              />
              <Button type="button" className="sm:col-span-2" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <Trash2 /> Remove
              </Button>
              <Select className="sm:col-span-3" aria-label="Timing" value={l.timing} onChange={(e) => set(i, { timing: e.target.value })}>
                {E.DRUG_TIMINGS.map((t) => (
                  <option key={t} value={t}>
                    {TIMING_LABEL[t] || 'Any time'}
                  </option>
                ))}
              </Select>
              <Select className="sm:col-span-2" aria-label="Route" value={l.route} onChange={(e) => set(i, { route: e.target.value })}>
                {E.DRUG_ROUTES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Input
                className="sm:col-span-7"
                aria-label="Instructions"
                placeholder="Instructions"
                maxLength={500}
                value={l.instructions}
                onChange={(e) => set(i, { instructions: e.target.value })}
              />
            </div>
          ))}
          <datalist id="fav-frequencies">
            {['1-0-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', ...Object.keys(E.FREQUENCIES)].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, toDraft()])}>
            <Plus /> Add medicine
          </Button>
          {(formError || save.error) && <p className="text-sm text-destructive">{formError ?? errorMessage(save.error)}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save favourite
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
