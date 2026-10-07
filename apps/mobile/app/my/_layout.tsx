import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { usePatientAuth } from '@/lib/patient-auth';
import { Centered, colors } from '@/ui';

/** Patient app: requires a patient (OTP) session. */
export default function PatientTabsLayout() {
  const { status } = usePatientAuth();
  if (status === 'loading') {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} size="large" />
      </Centered>
    );
  }
  if (status !== 'signedIn') return <Redirect href="/patient-login" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Visits', headerTitle: 'My appointments', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="records" options={{ title: 'Records', headerTitle: 'Prescriptions and bills', tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
