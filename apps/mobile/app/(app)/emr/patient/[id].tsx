import { useLocalSearchParams } from 'expo-router';
import type { QueueStatus } from '@/data/types';
import { PatientChartScreen } from '@/screens/PatientChartScreen';

export default function PatientChartRoute() {
  const p = useLocalSearchParams<{ id: string; encounterId?: string; visitId?: string; visitStatus?: string; token?: string }>();
  return (
    <PatientChartScreen
      patientId={p.id}
      encounterId={p.encounterId}
      visit={p.visitId ? { id: p.visitId, status: (p.visitStatus ?? 'waiting') as QueueStatus, tokenNo: p.token ? Number(p.token) : null } : undefined}
    />
  );
}
