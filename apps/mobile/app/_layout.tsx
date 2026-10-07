import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PatientAuthProvider, usePatientAuth } from '@/lib/patient-auth';
import { colors } from '@/ui';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const patient = usePatientAuth();
  const ready = status !== 'loading' && patient.status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="patient-login" />
      <Stack.Screen name="my" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PatientAuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </PatientAuthProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
