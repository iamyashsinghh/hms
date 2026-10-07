import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/lib/auth';
import { Centered, colors } from '@/ui';
import { variant } from '@/variants';

/**
 * Everything under app/(app)/ requires a signed-in user.
 * Module workstreams add their screens under app/(app)/<moduleKey>/ (they get a header by default).
 */
export default function AppLayout() {
  const { status } = useAuth();

  // The patient app has its own OTP session and screens under app/my.
  if (variant.key === 'patient') return <Redirect href="/my" />;
  if (status === 'loading') {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} size="large" />
      </Centered>
    );
  }
  if (status !== 'signedIn') return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
