'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { lab as L } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, formatINR, useDebounced } from '@/modules/billing/ui';
import { rangeText } from '@/modules/lab/ui';

interface RangeForm {
  gender: 'any' | 'male' | 'female';
  ageMinYears: string;
  ageMaxYears: string;
  low: string;
  high: string;
  criticalLow: string;
  criticalHigh: string;
  text: string;
}
interface TestForm {
  id?: string;
  code: string;
  name: string;
  section: L.LabSection;
  sampleType: L.SampleType;
  container: string;
  unit: string;
  method: string;
  resultType: L.ResultType;
  options: string;
  decimals: string;
  price: string;
  serviceCode: string;
  tatHours: string;
  isActive: boolean;
  ranges: RangeForm[];
}
interface PanelForm {
  id?: string;
  code: string;
  name: string;
  price: string;
  serviceCode: string;
  isActive: boolean;
  testIds: string[];
}

const blankRange: RangeForm = { gender: 'any', ageMinYears: '0', ageMaxYears: '150', low: '', high: '', criticalLow: '', criticalHigh: '', text: '' };
const blankTest: TestForm = {
  code: '',
  name: '',
  section: 'biochemistry',
  sampleType: 'serum',
  container: '',
  unit: '',
  method: '',
  resultType: 'numeric',
  options: '',
  decimals: '1',
  price: '',
  serviceCode: '',
  tatHours: '24',
  isActive: true,
  ranges: [{ ...blankRange }],
};
const blankPanel: PanelForm = { code: '', name: '', price: '', serviceCode: '', isActive: true, testIds: [] };

const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v));
const str = (v: number | null) => (v === null ? '' : String(v));

export default function LabCataloguePage() {
  const canRead = usePermission('lab.test.read');
  const canManage = usePermission('lab.test.manage');
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<'tests' | 'panels'>('tests');
  const [search, setSearch] = React.useState('');
  const q = useDebounced(search.trim());
  const [testForm, setTestForm] = React.useState<TestForm | null>(null);
  const [panelForm, setPanelForm] = React.useState<PanelForm | null>(null);

  const tests = useQuery({ queryKey: ['lab', 'tests', q], queryFn: () => api.lab.tests.list({ q: q || undefined, active: 'all' }), enabled: canRead });
  const panels = useQuery({ queryKey: ['lab', 'panels', q], queryFn: () => api.lab.panels.list({ q: q || undefined, active: 'all' }), enabled: canRead });
  const allTests = useQuery({ queryKey: ['lab', 'tests', 'active'], queryFn: () => api.lab.tests.list({ active: 'true' }), enabled: !!panelForm });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lab'] });

  const starter = useMutation({ mutationFn: () => api.lab.loadStarterCatalogue(), onSuccess: refresh });

  const saveTest = useMutation({
    mutationFn: (f: TestForm) => {
      const body = {
        name: f.name,
        section: f.section,
        sampleType: f.sampleType,
        container: f.container,
        unit: f.unit,
        method: f.method,
        resultType: f.resultType,
        options: f.resultType === 'option' ? f.options.split(',').map((o) => o.trim()).filter(Boolean) : [],
        decimals: Number(f.decimals || 0),
        price: Number(f.price || 0),
        serviceCode: f.serviceCode,
        tatHours: Number(f.tatHours || 0),
        isActive: f.isActive,
        ranges: f.ranges.map((r) => ({
          gender: r.gender,
          ageMinYears: Number(r.ageMinYears || 0),
          ageMaxYears: Number(r.ageMaxYears || 150),
          low: optNum(r.low),
          high: optNum(r.high),
          criticalLow: optNum(r.criticalLow),
          criticalHigh: optNum(r.criticalHigh),
          text: r.text || undefined,
        })),
      };
      return f.id ? api.lab.tests.update(f.id, body) : api.lab.tests.create({ ...body, code: f.code });
    },
    onSuccess: () => {
      setTestForm(null);
      refresh();
    },
  });

  const savePanel = useMutation({
    mutationFn: (f: PanelForm) => {
      const body = { name: f.name, price: Number(f.price || 0), serviceCode: f.serviceCode, isActive: f.isActive, testIds: f.testIds };
      return f.id ? api.lab.panels.update(f.id, body) : api.lab.panels.create({ ...body, code: f.code });
    },
    onSuccess: () => {
      setPanelForm(null);
      refresh();
    },
  });

  if (!canRead) return <NoAccess />;
  const empty = tests.data?.length === 0 && !q;

  const editTest = (t: L.LabTest) =>
    setTestForm({
      id: t.id,
      code: t.code,
      name: t.name,
      section: t.section,
      sampleType: t.sampleType,
      container: t.container ?? '',
      unit: t.unit ?? '',
      method: t.method ?? '',
      resultType: t.resultType,
      options: t.options.join(', '),
      decimals: String(t.decimals),
      price: String(t.price),
      serviceCode: t.serviceCode ?? '',
      tatHours: String(t.tatHours),
      isActive: t.isActive,
      ranges: t.ranges.map((r) => ({
        gender: r.gender,
        ageMinYears: String(r.ageMinYears),
        ageMaxYears: String(r.ageMaxYears),
        low: str(r.low),
        high: str(r.high),
        criticalLow: str(r.criticalLow),
        criticalHigh: str(r.criticalHigh),
        text: r.text ?? '',
      })),
    });

  return (
    <>
      <PageHeader
        title="Tests & panels"
        description="The lab catalogue: tests with units, reference and critical ranges, and panels (CBC, LFT…) that group them. Prices here are used when a test has no billing service code."
        actions={
          <Can permission="lab.test.manage">
            <Button variant="outline" disabled={starter.isPending} onClick={() => starter.mutate()}>
              {starter.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Add common tests
            </Button>
            <Button onClick={() => (tab === 'tests' ? setTestForm({ ...blankTest, ranges: [{ ...blankRange }] }) : setPanelForm({ ...blankPanel }))}>
              <Plus /> {tab === 'tests' ? 'Add test' : 'Add panel'}
            </Button>
          </Can>
        }
      />
      {starter.data && (
        <p className="mb-4 text-sm text-muted-foreground">
          Added {starter.data.testsAdded} tests and {starter.data.panelsAdded} panels. Review the prices and ranges for your lab.
        </p>
      )}
      <ErrorBox error={starter.error ? errorMessage(starter.error) : null} />

      {testForm && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{testForm.id ? `Edit ${testForm.code}` : 'New test'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveTest.mutate(testForm);
              }}
            >
              <div className="sm:col-span-4">
                <ErrorBox error={saveTest.error ? errorMessage(saveTest.error) : null} />
              </div>
              <Field id="t-code" label="Code *">
                <Input id="t-code" required disabled={!!testForm.id} value={testForm.code} onChange={(e) => setTestForm({ ...testForm, code: e.target.value.toUpperCase() })} placeholder="e.g. TSH" />
              </Field>
              <Field id="t-name" label="Name *" className="sm:col-span-2">
                <Input id="t-name" required value={testForm.name} onChange={(e) => setTestForm({ ...testForm, name: e.target.value })} />
              </Field>
              <Field id="t-section" label="Section">
                <Select id="t-section" value={testForm.section} onChange={(e) => setTestForm({ ...testForm, section: e.target.value as L.LabSection })}>
                  {L.LAB_SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {L.SECTION_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="t-sample" label="Sample">
                <Select id="t-sample" value={testForm.sampleType} onChange={(e) => setTestForm({ ...testForm, sampleType: e.target.value as L.SampleType })}>
                  {L.SAMPLE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="t-container" label="Container / tube">
                <Input id="t-container" value={testForm.container} onChange={(e) => setTestForm({ ...testForm, container: e.target.value })} placeholder="e.g. Plain (red)" />
              </Field>
              <Field id="t-unit" label="Unit">
                <Input id="t-unit" value={testForm.unit} onChange={(e) => setTestForm({ ...testForm, unit: e.target.value })} placeholder="e.g. mg/dL" />
              </Field>
              <Field id="t-method" label="Method">
                <Input id="t-method" value={testForm.method} onChange={(e) => setTestForm({ ...testForm, method: e.target.value })} />
              </Field>
              <Field id="t-type" label="Result type">
                <Select id="t-type" value={testForm.resultType} onChange={(e) => setTestForm({ ...testForm, resultType: e.target.value as L.ResultType })}>
                  <option value="numeric">Number</option>
                  <option value="option">Pick from list</option>
                  <option value="text">Free text</option>
                </Select>
              </Field>
              {testForm.resultType === 'option' ? (
                <Field id="t-options" label="Choices (normal first, comma separated)" className="sm:col-span-2">
                  <Input id="t-options" value={testForm.options} onChange={(e) => setTestForm({ ...testForm, options: e.target.value })} placeholder="Negative, Positive" />
                </Field>
              ) : (
                <Field id="t-decimals" label="Decimals">
                  <Input id="t-decimals" type="number" min={0} max={4} value={testForm.decimals} onChange={(e) => setTestForm({ ...testForm, decimals: e.target.value })} />
                </Field>
              )}
              <Field id="t-price" label="Price (₹)">
                <Input id="t-price" type="number" min={0} step="0.01" value={testForm.price} onChange={(e) => setTestForm({ ...testForm, price: e.target.value })} />
              </Field>
              <Field id="t-svc" label="Billing service code">
                <Input id="t-svc" value={testForm.serviceCode} onChange={(e) => setTestForm({ ...testForm, serviceCode: e.target.value.toUpperCase() })} placeholder="Optional" />
              </Field>
              <Field id="t-tat" label="Turnaround (hours)">
                <Input id="t-tat" type="number" min={0} value={testForm.tatHours} onChange={(e) => setTestForm({ ...testForm, tatHours: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" checked={testForm.isActive} onChange={(e) => setTestForm({ ...testForm, isActive: e.target.checked })} /> Active
              </label>

              <div className="sm:col-span-4">
                <p className="mb-2 text-sm font-medium">Reference ranges</p>
                <div className="space-y-2">
                  {testForm.ranges.map((r, i) => {
                    const set = (patch: Partial<RangeForm>) => setTestForm({ ...testForm, ranges: testForm.ranges.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-9">
                        <Select aria-label="Gender" value={r.gender} onChange={(e) => set({ gender: e.target.value as RangeForm['gender'] })}>
                          <option value="any">Any</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </Select>
                        <Input aria-label="Age from (years)" placeholder="Age from" value={r.ageMinYears} onChange={(e) => set({ ageMinYears: e.target.value })} />
                        <Input aria-label="Age to (years)" placeholder="Age to" value={r.ageMaxYears} onChange={(e) => set({ ageMaxYears: e.target.value })} />
                        <Input aria-label="Low" placeholder="Low" value={r.low} onChange={(e) => set({ low: e.target.value })} />
                        <Input aria-label="High" placeholder="High" value={r.high} onChange={(e) => set({ high: e.target.value })} />
                        <Input aria-label="Critical low" placeholder="Crit. low" value={r.criticalLow} onChange={(e) => set({ criticalLow: e.target.value })} />
                        <Input aria-label="Critical high" placeholder="Crit. high" value={r.criticalHigh} onChange={(e) => set({ criticalHigh: e.target.value })} />
                        <Input aria-label="Text shown on report" placeholder="Text (optional)" value={r.text} onChange={(e) => set({ text: e.target.value })} />
                        <Button type="button" variant="ghost" size="sm" aria-label="Remove range" onClick={() => setTestForm({ ...testForm, ranges: testForm.ranges.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setTestForm({ ...testForm, ranges: [...testForm.ranges, { ...blankRange }] })}>
                  <Plus /> Add range
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">Age is in years (from inclusive, to exclusive). A male/female range wins over an &ldquo;any&rdquo; range.</p>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-4">
                <Button type="button" variant="outline" onClick={() => setTestForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveTest.isPending}>
                  {saveTest.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {panelForm && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{panelForm.id ? `Edit ${panelForm.code}` : 'New panel'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                savePanel.mutate(panelForm);
              }}
            >
              <div className="sm:col-span-4">
                <ErrorBox error={savePanel.error ? errorMessage(savePanel.error) : null} />
              </div>
              <Field id="p-code" label="Code *">
                <Input id="p-code" required disabled={!!panelForm.id} value={panelForm.code} onChange={(e) => setPanelForm({ ...panelForm, code: e.target.value.toUpperCase() })} placeholder="e.g. LFT" />
              </Field>
              <Field id="p-name" label="Name *" className="sm:col-span-2">
                <Input id="p-name" required value={panelForm.name} onChange={(e) => setPanelForm({ ...panelForm, name: e.target.value })} />
              </Field>
              <Field id="p-price" label="Price (₹)">
                <Input id="p-price" type="number" min={0} step="0.01" value={panelForm.price} onChange={(e) => setPanelForm({ ...panelForm, price: e.target.value })} />
              </Field>
              <Field id="p-svc" label="Billing service code">
                <Input id="p-svc" value={panelForm.serviceCode} onChange={(e) => setPanelForm({ ...panelForm, serviceCode: e.target.value.toUpperCase() })} placeholder="Optional" />
              </Field>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" checked={panelForm.isActive} onChange={(e) => setPanelForm({ ...panelForm, isActive: e.target.checked })} /> Active
              </label>
              <Field label={`Tests in this panel (${panelForm.testIds.length})`} className="sm:col-span-4">
                <div className="grid max-h-64 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-3">
                  {allTests.data?.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={panelForm.testIds.includes(t.id)}
                        onChange={(e) =>
                          setPanelForm({ ...panelForm, testIds: e.target.checked ? [...panelForm.testIds, t.id] : panelForm.testIds.filter((x) => x !== t.id) })
                        }
                      />
                      {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <div className="flex justify-end gap-2 sm:col-span-4">
                <Button type="button" variant="outline" onClick={() => setPanelForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={savePanel.isPending || panelForm.testIds.length === 0}>
                  {savePanel.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Button size="sm" variant={tab === 'tests' ? 'default' : 'outline'} onClick={() => setTab('tests')}>
            Tests {tests.data && `(${tests.data.length})`}
          </Button>
          <Button size="sm" variant={tab === 'panels' ? 'default' : 'outline'} onClick={() => setTab('panels')}>
            Panels {panels.data && `(${panels.data.length})`}
          </Button>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search code or name…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {tab === 'tests' ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead>Normal range</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : empty ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No tests yet. Use &ldquo;Add common tests&rdquo; to start with about 45 everyday tests and 6 panels.
                  </TableCell>
                </TableRow>
              ) : (
                tests.data?.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="font-medium">
                      {t.name} {!t.isActive && <Badge variant="secondary">Inactive</Badge>}
                      {t.unit && <span className="ml-1 text-xs font-normal text-muted-foreground">({t.unit})</span>}
                    </TableCell>
                    <TableCell>{L.SECTION_LABELS[t.section]}</TableCell>
                    <TableCell className="capitalize">{t.sampleType}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.ranges
                        .map((r) => `${r.gender === 'any' ? '' : r.gender === 'male' ? 'M: ' : 'F: '}${rangeText({ refLow: r.low, refHigh: r.high, refText: r.text, decimals: t.decimals })}`)
                        .join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(t.price)}</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => editTest(t)}>
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Panel</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {panels.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No panels yet.
                  </TableCell>
                </TableRow>
              ) : (
                panels.data?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      {p.name} {!p.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="max-w-md text-sm text-muted-foreground">{p.tests.map((t) => t.name).join(', ')}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(p.price)}</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPanelForm({ id: p.id, code: p.code, name: p.name, price: String(p.price), serviceCode: p.serviceCode ?? '', isActive: p.isActive, testIds: p.tests.map((t) => t.id) })
                          }
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
