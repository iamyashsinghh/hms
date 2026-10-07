'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Plus, RefreshCw } from 'lucide-react';
import { integrations as I, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CheckboxGroup,
  Dialog,
  ErrorBox,
  Field,
  JsonDetails,
  MessageRow,
  Pager,
  PatientName,
  PatientPicker,
  StatusBadge,
  formatDateTime,
  isoDateOffset,
} from '@/modules/integrations/ui';

const PAGE_SIZE = 25;

const HI_TYPE_LABELS: Record<I.HealthInfoType, string> = {
  OPConsultation: 'OP consultation',
  Prescription: 'Prescription',
  DischargeSummary: 'Discharge summary',
  DiagnosticReport: 'Diagnostic report',
  ImmunizationRecord: 'Immunization record',
  HealthDocumentRecord: 'Health document',
  WellnessRecord: 'Wellness record',
};

interface Form {
  patient: Patient | null;
  purpose: I.ConsentPurpose;
  hiTypes: I.HealthInfoType[];
  dateFrom: string;
  dateTo: string;
  validDays: string;
}
const blankForm = (): Form => ({
  patient: null,
  purpose: 'CAREMGT',
  hiTypes: ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary'],
  dateFrom: isoDateOffset(-365),
  dateTo: isoDateOffset(0),
  validDays: '30',
});

export default function ConsentsPage() {
  const canRead = usePermission('integrations.consent.read');
  const canManage = usePermission('integrations.consent.manage');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<I.ConsentStatus | 'all'>('all');
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<Form | null>(null);
  const [viewing, setViewing] = React.useState<I.ConsentRequest | null>(null);

  const query: I.ConsentQuery = { status, page, pageSize: PAGE_SIZE };
  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'consents', query],
    queryFn: () => api.integrations.consents.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  const create = useMutation({
    mutationFn: (f: Form) =>
      api.integrations.consents.create({
        patientId: f.patient!.id,
        purpose: f.purpose,
        hiTypes: f.hiTypes,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        validDays: Number(f.validDays),
      }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'consents'] });
    },
  });
  const refresh = useMutation({
    mutationFn: (id: string) => api.integrations.consents.refresh(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'consents'] }),
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="ABDM consents"
        description="Ask a patient (through their ABHA app) for consent to view their health records from other hospitals and labs."
        actions={
          <Can permission="integrations.consent.manage">
            <Button onClick={() => setForm(blankForm())}>
              <Plus /> Request consent
            </Button>
          </Can>
        }
      />

      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New consent request</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(form);
              }}
            >
              <div className="sm:col-span-3">
                <ErrorBox error={create.error ? errorMessage(create.error) : null} />
              </div>
              <div className="sm:col-span-2">
                <PatientPicker value={form.patient} onChange={(p) => setForm({ ...form, patient: p })} label="Patient (must have a linked ABHA) *" />
              </div>
              <Field id="purpose" label="Purpose">
                <Select id="purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as I.ConsentPurpose })}>
                  {I.CONSENT_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {I.CONSENT_PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Record types *" className="sm:col-span-3">
                <CheckboxGroup
                  options={I.HEALTH_INFO_TYPES}
                  value={form.hiTypes}
                  onChange={(hiTypes) => setForm({ ...form, hiTypes })}
                  labels={HI_TYPE_LABELS}
                  className="grid gap-2 sm:grid-cols-3"
                />
              </Field>
              <Field id="from" label="Records from *">
                <Input id="from" type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} required />
              </Field>
              <Field id="to" label="Records to *" error={form.dateTo && form.dateFrom && form.dateTo < form.dateFrom ? 'End date must be on or after the start date' : undefined}>
                <Input id="to" type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} required />
              </Field>
              <Field id="valid" label="Consent valid for (days)">
                <Input id="valid" type="number" min={1} max={365} value={form.validDays} onChange={(e) => setForm({ ...form, validDays: e.target.value })} required />
              </Field>
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!form.patient || form.hiTypes.length === 0 || form.dateTo < form.dateFrom || create.isPending}>
                  {create.isPending && <Loader2 className="animate-spin" />}
                  Send request
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            className="w-44"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="requested">Requested</option>
            <option value="granted">Granted</option>
            <option value="denied">Denied</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </Select>
          {refresh.error && <ErrorBox error={errorMessage(refresh.error)} />}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Patient</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Record types</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
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
            ) : data.items.length === 0 ? (
              <MessageRow colSpan={7}>No consent requests yet.</MessageRow>
            ) : (
              data.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <PatientName id={c.patientId} />
                    <span className="block text-xs text-muted-foreground">{c.abhaAddress}</span>
                  </TableCell>
                  <TableCell className="text-sm">{I.CONSENT_PURPOSE_LABELS[c.purpose] ?? c.purpose}</TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {c.hiTypes.map((h) => (
                        <Badge key={h} variant="secondary">
                          {HI_TYPE_LABELS[h] ?? h}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDate(c.dateFrom)} – {formatDate(c.dateTo)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                    {c.status === 'granted' && <span className="block text-xs text-muted-foreground">until {formatDate(c.expiresAt)}</span>}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(c.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(c.status === 'requested' || c.status === 'granted') && (
                        <Button variant="ghost" size="sm" disabled={refresh.isPending && refresh.variables === c.id} onClick={() => refresh.mutate(c.id)}>
                          {refresh.isPending && refresh.variables === c.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          Refresh
                        </Button>
                      )}
                      {c.status === 'granted' && (
                        <Button variant="outline" size="sm" onClick={() => setViewing(c)}>
                          <Eye /> View records
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title="Health records received" wide>
        {viewing && <RecordsView consent={viewing} />}
      </Dialog>
    </>
  );
}

function RecordsView({ consent }: { consent: I.ConsentRequest }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'consents', consent.id, 'records'],
    queryFn: () => api.integrations.consents.records(consent.id),
  });
  if (error) return <ErrorBox error={errorMessage(error)} />;
  if (isPending) return <p className="text-sm text-muted-foreground">Fetching records…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No records have arrived yet for this consent. Try Refresh in a moment.</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        <PatientName id={consent.patientId} /> · {data.length} bundle{data.length === 1 ? '' : 's'} (FHIR R4)
      </p>
      {data.map((b, i) => (
        <BundleView key={b.id ?? i} bundle={b} index={i} />
      ))}
    </div>
  );
}

function BundleView({ bundle, index }: { bundle: I.FhirBundle; index: number }) {
  const resources = (bundle.entry ?? []).map((e) => e.resource);
  const counts = resources.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.resourceType]: (acc[r.resourceType] ?? 0) + 1 }), {});
  const composition = resources.find((r) => r.resourceType === 'Composition');
  const title = (composition && str(composition.title)) || `Bundle ${index + 1}`;
  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="font-medium">{title}</span>
        {composition && str(composition.date) && <span className="text-xs text-muted-foreground">{formatDate(str(composition.date))}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          {Object.entries(counts).map(([t, n]) => (
            <Badge key={t} variant="outline">
              {t} × {n}
            </Badge>
          ))}
        </span>
      </div>
      <ul className="divide-y text-sm">
        {resources
          .filter((r) => r.resourceType !== 'Composition')
          .map((r, i) => (
            <li key={r.id ?? i} className="flex gap-3 px-4 py-2">
              <Badge variant="secondary" className="h-fit shrink-0">
                {r.resourceType}
              </Badge>
              <span className="min-w-0">{summarize(r)}</span>
            </li>
          ))}
      </ul>
      <div className="p-3">
        <JsonDetails value={bundle} summary="Raw FHIR JSON" />
      </div>
    </div>
  );
}

// ---- FHIR summary helpers (defensive: the resources come from other systems) ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
function codeText(v: unknown): string {
  if (!isObj(v)) return '';
  if (str(v.text)) return str(v.text);
  const coding = Array.isArray(v.coding) ? v.coding.find(isObj) : undefined;
  return coding ? str(coding.display) || str(coding.code) : '';
}
function humanName(v: unknown): string {
  const n = Array.isArray(v) ? v.find(isObj) : undefined;
  if (!n) return '';
  if (str(n.text)) return str(n.text);
  const given = Array.isArray(n.given) ? n.given.map(str).join(' ') : '';
  return [Array.isArray(n.prefix) ? n.prefix.map(str).join(' ') : '', given, str(n.family)].filter(Boolean).join(' ');
}
function quantity(v: unknown): string {
  if (!isObj(v)) return '';
  return [str(v.value), str(v.unit) || str(v.code)].filter(Boolean).join(' ');
}

function summarize(r: I.FhirResource): string {
  const x = r as Obj;
  switch (r.resourceType) {
    case 'Patient':
      return [humanName(x.name), str(x.gender), str(x.birthDate)].filter(Boolean).join(' · ') || 'Patient';
    case 'Practitioner':
      return humanName(x.name) || 'Practitioner';
    case 'Organization':
      return str(x.name) || 'Organization';
    case 'Encounter':
      return [isObj(x.class) ? str(x.class.display) || str(x.class.code) : '', isObj(x.period) ? str(x.period.start) : '', str(x.status)].filter(Boolean).join(' · ') || 'Encounter';
    case 'Observation': {
      const value = quantity(x.valueQuantity) || str(x.valueString) || codeText(x.valueCodeableConcept);
      const interp = Array.isArray(x.interpretation) ? codeText(x.interpretation[0]) : '';
      return `${codeText(x.code) || 'Observation'}${value ? `: ${value}` : ''}${interp ? ` (${interp})` : ''}`;
    }
    case 'Condition':
      return [codeText(x.code), isObj(x.clinicalStatus) ? codeText(x.clinicalStatus) : ''].filter(Boolean).join(' · ') || 'Condition';
    case 'AllergyIntolerance':
      return codeText(x.code) || 'Allergy';
    case 'MedicationRequest':
    case 'MedicationStatement': {
      const med = codeText(x.medicationCodeableConcept) || (isObj(x.medicationReference) ? str(x.medicationReference.display) : '');
      const dosage = Array.isArray(x.dosageInstruction) && isObj(x.dosageInstruction[0]) ? str(x.dosageInstruction[0].text) : '';
      return [med || 'Medication', dosage].filter(Boolean).join(' · ');
    }
    case 'DiagnosticReport':
      return [codeText(x.code), str(x.conclusion), str(x.issued) || str(x.effectiveDateTime)].filter(Boolean).join(' · ') || 'Diagnostic report';
    case 'Immunization':
      return [codeText(x.vaccineCode), str(x.occurrenceDateTime)].filter(Boolean).join(' · ') || 'Immunization';
    case 'Procedure':
      return [codeText(x.code), str(x.performedDateTime)].filter(Boolean).join(' · ') || 'Procedure';
    case 'DocumentReference':
      return str(x.description) || codeText(x.type) || 'Document';
    default:
      return codeText(x.code) || str(x.title) || str(x.name) || str(x.status) || r.id || r.resourceType;
  }
}
