import { Stack } from 'expo-router';
import { OwnerSummaryScreen } from '@/screens/OwnerSummaryScreen';

export default function OwnerSummaryRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Daily summary' }} />
      <OwnerSummaryScreen />
    </>
  );
}
