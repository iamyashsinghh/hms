import { Stack } from 'expo-router';
import { DoctorQueueScreen } from '@/screens/DoctorQueueScreen';

export default function EmrQueueRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Today's OPD queue" }} />
      <DoctorQueueScreen />
    </>
  );
}
