'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, S, SuccessBox, titleCase } from '@/modules/setup/ui';

function TemplateCard({ t, profile }: { t: setup.PrintTemplate; profile?: setup.HospitalProfile }) {
  const queryClient = useQueryClient();
  const [v, setV] = React.useState({
    paperSize: t.paperSize,
    showLogo: t.showLogo,
    showLetterhead: t.showLetterhead,
    headerText: t.headerText ?? '',
    footerText: t.footerText ?? '',
    marginTopMm: t.marginTopMm,
    marginBottomMm: t.marginBottomMm,
  });
  const save = useMutation({
    mutationFn: () => api.setup.savePrintTemplate(t.key, { ...v, headerText: v.headerText || undefined, footerText: v.footerText || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup', 'print-templates'] }),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{titleCase(t.key)}</CardTitle>
        {t.saved ? <Badge>Customised</Badge> : <Badge variant="secondary">Default</Badge>}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <ErrorBox error={save.error} />
          {save.isSuccess && <SuccessBox>Saved.</SuccessBox>}
          <div className="grid grid-cols-3 gap-3">
            <Field id={`${t.key}-paper`} label="Paper">
              <Select id={`${t.key}-paper`} value={v.paperSize} onChange={(e) => setV({ ...v, paperSize: e.target.value as typeof v.paperSize })}>
                {S.PAPER_SIZES.map((p) => (
                  <option key={p} value={p}>
                    {p === 'thermal_80mm' ? 'Thermal 80mm' : p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${t.key}-mt`} label="Top margin (mm)">
              <Input id={`${t.key}-mt`} type="number" min={0} max={100} value={v.marginTopMm} onChange={(e) => setV({ ...v, marginTopMm: Number(e.target.value) })} />
            </Field>
            <Field id={`${t.key}-mb`} label="Bottom (mm)">
              <Input id={`${t.key}-mb`} type="number" min={0} max={100} value={v.marginBottomMm} onChange={(e) => setV({ ...v, marginBottomMm: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={v.showLetterhead} onChange={(e) => setV({ ...v, showLetterhead: e.target.checked })} /> Letterhead
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={v.showLogo} onChange={(e) => setV({ ...v, showLogo: e.target.checked })} /> Logo
            </label>
          </div>
          <Field id={`${t.key}-header`} label="Extra header text">
            <Input id={`${t.key}-header`} value={v.headerText} onChange={(e) => setV({ ...v, headerText: e.target.value })} />
          </Field>
          <Field id={`${t.key}-footer`} label="Footer text">
            <Input id={`${t.key}-footer`} value={v.footerText} onChange={(e) => setV({ ...v, footerText: e.target.value })} placeholder="e.g. Goods once sold will not be taken back" />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
        <div className={v.paperSize === 'thermal_80mm' ? 'mx-auto w-56 rounded border bg-white p-3 text-[10px] text-slate-800 shadow-sm' : 'rounded border bg-white p-4 text-xs text-slate-800 shadow-sm'}>
          {v.showLetterhead && (
            <div className="mb-2 border-b pb-2 text-center" style={{ borderColor: profile?.letterhead?.accentColor }}>
              {v.showLogo && profile?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logoUrl} alt="" className="mx-auto mb-1 h-8" />
              )}
              <p className="text-sm font-bold" style={{ color: profile?.letterhead?.accentColor }}>
                {profile?.displayName}
              </p>
              {profile?.letterhead?.tagline && <p className="italic">{profile.letterhead.tagline}</p>}
              <p>{[profile?.address?.line1, profile?.address?.city, profile?.address?.pincode].filter(Boolean).join(', ')}</p>
              {profile?.gstin && <p>GSTIN: {profile.gstin}</p>}
            </div>
          )}
          {v.headerText && <p className="mb-2 text-center">{v.headerText}</p>}
          <div className="my-3 space-y-1 text-slate-400">
            <div className="h-2 rounded bg-slate-100" />
            <div className="h-2 w-3/4 rounded bg-slate-100" />
            <div className="h-2 w-1/2 rounded bg-slate-100" />
          </div>
          {(v.footerText || profile?.letterhead?.footerNote) && (
            <p className="mt-2 border-t pt-2 text-center">{v.footerText || profile?.letterhead?.footerNote}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PrintTemplatesPage() {
  const canManage = usePermission('setup.template.manage');
  const templates = useQuery({ queryKey: ['setup', 'print-templates'], queryFn: () => api.setup.listPrintTemplates(), enabled: canManage });
  const profile = useQuery({ queryKey: ['setup', 'profile'], queryFn: () => api.setup.getProfile(), enabled: canManage });
  if (!canManage) return <NoAccess />;
  if (templates.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (templates.error) return <p className="text-sm text-destructive">{errorMessage(templates.error)}</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Print templates" description="Paper size, letterhead and footer for each printout. Hospital name and GSTIN come from the hospital profile." />
      {templates.data.map((t) => (
        <TemplateCard key={`${t.key}:${t.saved}`} t={t} profile={profile.data} />
      ))}
    </div>
  );
}
