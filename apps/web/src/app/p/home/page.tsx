'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, CalendarPlus, FileText, LogOut, Pill, Receipt, Users } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { usePatientSession } from '@/modules/portal/patient-session';
import { AppointmentsTab } from '@/modules/portal/components/appointments';
import { BookTab } from '@/modules/portal/components/book';
import { FamilyTab } from '@/modules/portal/components/family';
import { BillsTab, PrescriptionsTab, ReportsTab } from '@/modules/portal/components/records';
import { PatientPicker } from '@/modules/portal/components/shared';

const TABS = [
  { key: 'appointments', label: 'Appointments', icon: CalendarDays },
  { key: 'book', label: 'Book', icon: CalendarPlus },
  { key: 'prescriptions', label: 'Prescriptions', icon: Pill },
  { key: 'bills', label: 'Bills', icon: Receipt },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'family', label: 'Family', icon: Users },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function PatientHomePage() {
  const { status, me, signOut, reload } = usePatientSession();
  const router = useRouter();
  const [chosen, setTab] = React.useState<Tab | null>(null);
  const [patientId, setPatientId] = React.useState('');

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/p');
  }, [status, router]);

  if (!me) return <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>;
  // New accounts with no linked patient start on Family to register themselves.
  const tab: Tab = chosen ?? (me.patients.length ? 'appointments' : 'family');

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <p className="text-sm font-semibold leading-tight">{me.hospitalName}</p>
              <p className="text-xs text-muted-foreground">Hello{me.name ? `, ${me.name}` : ''} · {me.mobile}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                tab === t.key ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {['appointments', 'prescriptions', 'bills', 'reports'].includes(tab) && (
          <PatientPicker patients={me.patients} value={patientId} onChange={setPatientId} />
        )}
        {tab === 'appointments' && <AppointmentsTab patientId={patientId} onBook={() => setTab('book')} />}
        {tab === 'book' && <BookTab patients={me.patients} defaultPatientId={patientId} onBooked={() => setTab('appointments')} />}
        {tab === 'prescriptions' && <PrescriptionsTab patientId={patientId} />}
        {tab === 'bills' && <BillsTab patientId={patientId} />}
        {tab === 'reports' && <ReportsTab patientId={patientId} />}
        {tab === 'family' && <FamilyTab patients={me.patients} onChanged={reload} />}
      </main>
    </div>
  );
}
