import { PortalList } from '@/screens/PortalList';

export default function MyAppointments() {
  return <PortalList kinds={[{ kind: 'appointments', title: 'Appointments', empty: 'No appointments yet' }]} emptyIcon="calendar-outline" />;
}
