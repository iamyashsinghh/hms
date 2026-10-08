'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PhoneCall, Plus } from 'lucide-react';
import { ops as O, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ErrorBox,
  Field,
  MessageRow,
  PatientPicker,
  StatusBadge,
  TRIP_KIND_LABELS,
  TRIP_STATUS,
  Tabs,
  VEHICLE_STATUS,
  VEHICLE_TYPE_LABELS,
  formatDateTime,
  formatINR,
  checked,
  num,
  opt,
  firstIssue,
  todayIST,
} from '@/modules/ops/ui';

interface VehicleForm {
  id?: string;
  registrationNo: string;
  type: O.VehicleType;
  driverName: string;
  driverMobile: string;
  ratePerKm: string;
  baseCharge: string;
  status: 'available' | 'maintenance' | 'inactive' | '';
}
const blankVehicle: VehicleForm = { registrationNo: '', type: 'bls', driverName: '', driverMobile: '', ratePerKm: '', baseCharge: '', status: '' };

function VehicleFormCard({ initial, onDone }: { initial: VehicleForm; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = React.useState(initial);
  const labels = { registrationNo: 'Registration no.', driverMobile: 'Driver mobile', driverName: 'Driver', ratePerKm: 'Rate per km', baseCharge: 'Base charge' };
  const save = useMutation({
    mutationFn: () => {
      const body: O.VehicleInput = {
        registrationNo: f.registrationNo,
        type: f.type,
        driverName: opt(f.driverName),
        driverMobile: opt(f.driverMobile),
        ratePerKm: num(f.ratePerKm),
        baseCharge: num(f.baseCharge),
        status: f.status || undefined,
      };
      if (!f.id) {
        const problem = firstIssue(O.vehicleInputSchema, body, labels);
        if (problem) throw new Error(problem);
        return api.ops.ambulance.createVehicle(body);
      }
      // On edit an emptied driver name / mobile is cleared, not kept.
      const patch: O.UpdateVehicle = { ...body, driverName: opt(f.driverName) ?? null, driverMobile: opt(f.driverMobile) ?? null };
      const problem = firstIssue(O.updateVehicleSchema, patch, labels);
      if (problem) throw new Error(problem);
      return api.ops.ambulance.updateVehicle(f.id, patch);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{f.id ? `Edit ${initial.registrationNo}` : 'Add ambulance'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          </div>
          <Field id="v-reg" label="Registration no. *">
            <Input id="v-reg" value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value.toUpperCase() })} placeholder="MH12AB1234" required />
          </Field>
          <Field id="v-type" label="Type">
            <Select id="v-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as O.VehicleType })}>
              {O.VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="v-driver" label="Driver name">
            <Input id="v-driver" value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} />
          </Field>
          <Field id="v-mobile" label="Driver mobile">
            <Input id="v-mobile" inputMode="numeric" maxLength={10} pattern="[6-9][0-9]{9}" value={f.driverMobile} onChange={(e) => setF({ ...f, driverMobile: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="v-base" label="Base charge (₹)">
            <Input id="v-base" type="number" min={0} step="0.01" value={f.baseCharge} onChange={(e) => setF({ ...f, baseCharge: e.target.value })} />
          </Field>
          <Field id="v-rate" label="Rate per km (₹)">
            <Input id="v-rate" type="number" min={0} step="0.01" value={f.ratePerKm} onChange={(e) => setF({ ...f, ratePerKm: e.target.value })} />
          </Field>
          <Field id="v-status" label="Status">
            <Select id="v-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as VehicleForm['status'] })}>
              <option value="">{f.id ? 'No change' : 'Available'}</option>
              <option value="available">Available</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="flex items-end justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
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
  );
}

function BookTripForm({ vehicles, onDone }: { vehicles: O.Vehicle[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [f, setF] = React.useState({ kind: 'emergency_pickup' as O.TripKind, contactName: '', contactMobile: '', pickupAddress: '', dropAddress: '', notes: '', vehicleId: '' });
  const book = useMutation({
    mutationFn: () =>
      api.ops.ambulance.createTrip(checked(O.createTripSchema, {
        kind: f.kind,
        patientId: patient?.id,
        contactName: f.contactName.trim(),
        contactMobile: f.contactMobile,
        pickupAddress: f.pickupAddress.trim(),
        dropAddress: opt(f.dropAddress),
        notes: opt(f.notes),
        vehicleId: f.vehicleId || undefined,
      })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  const pick = (p: Patient | null) => {
    setPatient(p);
    if (p) setF((x) => ({ ...x, contactName: x.contactName || fullName(p), contactMobile: x.contactMobile || (p.mobile ?? '') }));
  };
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Book ambulance trip</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            book.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={book.error ? errorMessage(book.error) : null} />
          </div>
          <Field id="t-kind" label="Trip type">
            <Select id="t-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as O.TripKind })}>
              {O.TRIP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TRIP_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <PatientPicker value={patient} onChange={pick} label="Registered patient (optional, needed for billing)" />
          </div>
          <Field id="t-name" label="Contact / patient name *">
            <Input id="t-name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} required />
          </Field>
          <Field id="t-mobile" label="Contact mobile *">
            <Input
              id="t-mobile"
              inputMode="numeric"
              maxLength={10}
              pattern="[6-9][0-9]{9}"
              title="10-digit mobile number"
              value={f.contactMobile}
              onChange={(e) => setF({ ...f, contactMobile: e.target.value.replace(/\D/g, '') })}
              required
            />
          </Field>
          <Field id="t-vehicle" label="Assign vehicle now (optional)" className="sm:col-span-2">
            <Select id="t-vehicle" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
              <option value="">Later</option>
              {vehicles
                .filter((v) => v.status === 'available')
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNo} · {VEHICLE_TYPE_LABELS[v.type]}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="t-pickup" label="Pickup address *" className="sm:col-span-2">
            <Input id="t-pickup" value={f.pickupAddress} onChange={(e) => setF({ ...f, pickupAddress: e.target.value })} required />
          </Field>
          <Field id="t-drop" label="Drop address" className="sm:col-span-2">
            <Input id="t-drop" value={f.dropAddress} onChange={(e) => setF({ ...f, dropAddress: e.target.value })} placeholder="Defaults to this hospital" />
          </Field>
          <Field id="t-notes" label="Notes" className="sm:col-span-4">
            <Input id="t-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Condition, oxygen needed, landmark…" />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={book.isPending}>
              {book.isPending && <Loader2 className="animate-spin" />}
              Book trip
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type ActionPanel = { tripId: string; kind: 'dispatch' | 'complete' | 'cancel' };

function TripActionForm({ trip, kind, vehicles, onDone }: { trip: O.Trip; kind: ActionPanel['kind']; vehicles: O.Vehicle[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const available = vehicles.filter((v) => v.status === 'available');
  const [vehicleId, setVehicleId] = React.useState(trip.vehicleId ?? available[0]?.id ?? '');
  const [odoStart, setOdoStart] = React.useState('');
  const [odoEnd, setOdoEnd] = React.useState('');
  const [distance, setDistance] = React.useState('');
  const [bill, setBill] = React.useState(!!trip.patientId);
  const [charge, setCharge] = React.useState('');
  const [reason, setReason] = React.useState('');
  const act = useMutation({
    mutationFn: () => {
      const body: O.TripAction =
        kind === 'dispatch'
          ? { action: 'dispatch', vehicleId, odometerStart: num(odoStart) }
          : kind === 'complete'
            ? { action: 'complete', odometerEnd: num(odoEnd), distanceKm: num(distance), bill: !!trip.patientId && bill, charge: num(charge) }
            : { action: 'cancel', reason: reason.trim() };
      return api.ops.ambulance.tripAction(trip.id, checked(O.tripActionSchema, body));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        act.mutate();
      }}
    >
      <div className="sm:col-span-5">
        <ErrorBox error={act.error ? errorMessage(act.error) : null} />
      </div>
      {kind === 'dispatch' && (
        <>
          <Field id={`dv-${trip.id}`} label="Vehicle *" className="sm:col-span-2">
            <Select id={`dv-${trip.id}`} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">Select…</option>
              {vehicles
                .filter((v) => v.status === 'available' || v.id === trip.vehicleId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNo} · {VEHICLE_TYPE_LABELS[v.type]}
                    {v.driverName ? ` · ${v.driverName}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id={`os-${trip.id}`} label="Odometer start (km)">
            <Input id={`os-${trip.id}`} type="number" min={0} value={odoStart} onChange={(e) => setOdoStart(e.target.value)} />
          </Field>
        </>
      )}
      {kind === 'complete' && (
        <>
          <Field id={`oe-${trip.id}`} label={`Odometer end (km)${trip.odometerStart != null ? ` · start ${trip.odometerStart}` : ''}`}>
            <Input id={`oe-${trip.id}`} type="number" min={trip.odometerStart ?? 0} value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} />
          </Field>
          <Field id={`dk-${trip.id}`} label="or distance (km)">
            <Input id={`dk-${trip.id}`} type="number" min={0} step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </Field>
          <Field id={`ch-${trip.id}`} label="Charge override (₹)">
            <Input id={`ch-${trip.id}`} type="number" min={0} step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} placeholder="Auto from rate" />
          </Field>
          {trip.patientId ? (
            <label className="flex items-center gap-2 pt-7 text-sm">
              <input type="checkbox" checked={bill} onChange={(e) => setBill(e.target.checked)} /> Bill patient
            </label>
          ) : (
            <p className="pt-7 text-xs text-muted-foreground">Not a registered patient: no bill will be raised.</p>
          )}
        </>
      )}
      {kind === 'cancel' && (
        <Field id={`cr-${trip.id}`} label="Reason *" className="sm:col-span-3">
          <Input id={`cr-${trip.id}`} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
        </Field>
      )}
      <div className="flex items-end justify-end gap-2 sm:col-start-5">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" variant={kind === 'cancel' ? 'destructive' : 'default'} disabled={act.isPending || (kind === 'dispatch' && !vehicleId)}>
          {act.isPending && <Loader2 className="animate-spin" />}
          {kind === 'dispatch' ? 'Dispatch' : kind === 'complete' ? 'Complete trip' : 'Cancel trip'}
        </Button>
      </div>
    </form>
  );
}

function TripsTable({ trips, isPending, vehicles }: { trips: O.Trip[] | undefined; isPending: boolean; vehicles: O.Vehicle[] }) {
  const canManage = usePermission('ops.ambulance.manage');
  const queryClient = useQueryClient();
  const [panel, setPanel] = React.useState<ActionPanel | null>(null);
  const onboard = useMutation({
    mutationFn: (id: string) => api.ops.ambulance.tripAction(id, { action: 'onboard' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ops'] }),
  });
  return (
    <>
      {onboard.error && (
        <div className="p-4 pb-0">
          <ErrorBox error={errorMessage(onboard.error)} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Trip</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Route</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Charge</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending || !trips ? (
            <MessageRow cols={7}>Loading…</MessageRow>
          ) : trips.length === 0 ? (
            <MessageRow cols={7}>No trips.</MessageRow>
          ) : (
            trips.map((t) => {
              const open = t.status !== 'completed' && t.status !== 'cancelled';
              return (
                <React.Fragment key={t.id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-mono text-xs">{t.number}</div>
                      <div className="text-xs text-muted-foreground">{TRIP_KIND_LABELS[t.kind]}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(t.requestedAt)}</div>
                    </TableCell>
                    <TableCell>
                      {t.patientId ? (
                        <Link href={`/patients/${t.patientId}`} className="font-medium text-primary hover:underline">
                          {t.contactName}
                        </Link>
                      ) : (
                        <span className="font-medium">{t.contactName}</span>
                      )}
                      <div className="text-xs text-muted-foreground">{t.contactMobile}</div>
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-xs">
                      <div>From: {t.pickupAddress}</div>
                      {t.dropAddress && <div>To: {t.dropAddress}</div>}
                      {t.notes && <div className="text-muted-foreground">{t.notes}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.vehicleRegistrationNo ?? '—'}
                      {t.distanceKm != null && <div className="text-muted-foreground">{t.distanceKm} km</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={TRIP_STATUS[t.status]} />
                      {t.cancelReason && <div className="text-xs text-muted-foreground">{t.cancelReason}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.charge != null ? formatINR(t.charge) : '—'}
                      {t.invoiceId && (
                        <div>
                          <Link href={`/billing/invoices/${t.invoiceId}`} className="text-primary hover:underline">
                            View bill
                          </Link>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && open && (
                        <div className="flex justify-end gap-1">
                          {t.status === 'requested' && (
                            <Button size="sm" onClick={() => setPanel({ tripId: t.id, kind: 'dispatch' })}>
                              Dispatch
                            </Button>
                          )}
                          {t.status === 'dispatched' && (
                            <Button size="sm" variant="outline" disabled={onboard.isPending} onClick={() => onboard.mutate(t.id)}>
                              On board
                            </Button>
                          )}
                          {(t.status === 'dispatched' || t.status === 'patient_onboard') && (
                            <Button size="sm" onClick={() => setPanel({ tripId: t.id, kind: 'complete' })}>
                              Complete
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setPanel({ tripId: t.id, kind: 'cancel' })}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  {panel?.tripId === t.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7}>
                        <TripActionForm key={panel.kind} trip={t} kind={panel.kind} vehicles={vehicles} onDone={() => setPanel(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </>
  );
}

export default function AmbulancePage() {
  const canRead = usePermission('ops.ambulance.read');
  const canManage = usePermission('ops.ambulance.manage');
  const [panel, setPanel] = React.useState<'book' | VehicleForm | null>(null);
  const [tab, setTab] = React.useState<'active' | 'today'>('active');
  const today = todayIST();

  const vehicles = useQuery({ queryKey: ['ops', 'ambulance', 'vehicles'], queryFn: () => api.ops.ambulance.vehicles(), enabled: canRead });
  const tripQuery: O.TripQuery = tab === 'active' ? { active: 'true', pageSize: 100 } : { date: today, pageSize: 100 };
  const trips = useQuery({ queryKey: ['ops', 'ambulance', 'trips', tripQuery], queryFn: () => api.ops.ambulance.trips(tripQuery), enabled: canRead, refetchInterval: 30_000 });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Ambulance"
        description="Fleet status, trip booking, dispatch and billing."
        actions={
          <Can permission="ops.ambulance.manage">
            <Button variant="outline" onClick={() => setPanel({ ...blankVehicle })}>
              <Plus /> Add vehicle
            </Button>
            <Button onClick={() => setPanel('book')}>
              <PhoneCall /> Book trip
            </Button>
          </Can>
        }
      />

      {canManage && panel === 'book' && <BookTripForm vehicles={vehicles.data ?? []} onDone={() => setPanel(null)} />}
      {canManage && panel && panel !== 'book' && <VehicleFormCard key={panel.id ?? 'new'} initial={panel} onDone={() => setPanel(null)} />}

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle>Trips</CardTitle>
        </CardHeader>
        <div className="px-6">
          <Tabs
            tabs={[
              { key: 'active', label: 'Active trips' },
              { key: 'today', label: "Today's trips" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {trips.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(trips.error)}</p>
        ) : (
          <TripsTable trips={trips.data?.items} isPending={trips.isPending} vehicles={vehicles.data ?? []} />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
        </CardHeader>
        {vehicles.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(vehicles.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Registration</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Base / per km</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.isPending ? (
                <MessageRow cols={6}>Loading…</MessageRow>
              ) : vehicles.data.length === 0 ? (
                <MessageRow cols={6}>No ambulances registered.</MessageRow>
              ) : (
                vehicles.data.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-medium">{v.registrationNo}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{VEHICLE_TYPE_LABELS[v.type]}</Badge>
                    </TableCell>
                    <TableCell>
                      {v.driverName ?? '—'}
                      {v.driverMobile && <div className="text-xs text-muted-foreground">{v.driverMobile}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={VEHICLE_STATUS[v.status]} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatINR(v.baseCharge)} + {formatINR(v.ratePerKm)}/km
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPanel({
                              id: v.id,
                              registrationNo: v.registrationNo,
                              type: v.type,
                              driverName: v.driverName ?? '',
                              driverMobile: v.driverMobile ?? '',
                              ratePerKm: String(v.ratePerKm),
                              baseCharge: String(v.baseCharge),
                              status: '',
                            })
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
