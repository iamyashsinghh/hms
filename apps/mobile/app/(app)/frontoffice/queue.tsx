import { Stack } from 'expo-router';
import { FrontofficeQueueScreen } from '@/screens/FrontofficeQueueScreen';

export default function FrontofficeQueueRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'OPD queue' }} />
      <FrontofficeQueueScreen />
    </>
  );
}
