import { useLocalSearchParams } from 'expo-router';
import { PatientChartScreen } from '@/screens/PatientChartScreen';

export default function PatientChartRoute() {
  const { id, encounterId } = useLocalSearchParams<{ id: string; encounterId?: string }>();
  return <PatientChartScreen patientId={id} encounterId={encounterId} />;
}
