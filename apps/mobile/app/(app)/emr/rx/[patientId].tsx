import { useLocalSearchParams } from 'expo-router';
import { WritePrescriptionScreen } from '@/screens/WritePrescriptionScreen';

export default function WritePrescriptionRoute() {
  const { patientId, encounterId } = useLocalSearchParams<{ patientId: string; encounterId?: string }>();
  return <WritePrescriptionScreen patientId={patientId} encounterId={encounterId} />;
}
