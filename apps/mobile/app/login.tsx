import { ApiError } from '@hms/api-client';
import { loginRequestSchema } from '@hms/shared';
import * as Device from 'expo-device';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { Button, Card, ErrorText, Field, colors, space } from '@/ui';
import { variant } from '@/variants';

export default function LoginScreen() {
  const { status, login, bootError, restore } = useAuth();
  const [tenantCode, setTenantCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (variant.key === 'patient') return <Redirect href="/patient-login" />;
  if (status === 'signedIn') return <Redirect href={variant.landing} />;

  async function submit() {
    setError(null);
    const deviceName = `${variant.title} · ${Device.deviceName ?? Device.modelName ?? Platform.OS}`.slice(0, 100);
    const parsed = loginRequestSchema.safeParse({ tenantCode, identifier, password, client: 'mobile', deviceName });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'tenantCode'
          ? 'Enter your hospital code'
          : field === 'identifier'
            ? 'Enter your email or mobile number'
            : 'Password must be at least 8 characters',
      );
      return;
    }
    setBusy(true);
    try {
      const { tenantCode: t, identifier: i, password: p } = parsed.data;
      await login({ tenantCode: t, identifier: i, password: p, deviceName });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'Wrong hospital code, username or password'
            : err.message
          : `Cannot reach the server (${API_URL})`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <View style={s.logo}>
              <Text style={s.logoText}>H</Text>
            </View>
            <Text style={s.title}>{variant.title}</Text>
            <Text style={s.tagline}>{variant.tagline}</Text>
          </View>

          <Card style={{ gap: space.lg }}>
            <Field
              label="Hospital code"
              value={tenantCode}
              onChangeText={setTenantCode}
              placeholder="e.g. demo"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label="Email or mobile"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@hospital.in or 98XXXXXXXX"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              textContentType="password"
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            {error ? <ErrorText>{error}</ErrorText> : null}
            {!error && bootError ? (
              <View style={{ gap: space.sm }}>
                <ErrorText>Could not restore your session: {bootError}</ErrorText>
                <Button title="Retry" variant="outline" onPress={restore} />
              </View>
            ) : null}
            <Button title="Sign in" onPress={submit} loading={busy} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  brand: { alignItems: 'center', gap: space.sm },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: colors.accent,
  },
  logoText: { color: colors.white, fontSize: 30, fontWeight: '800' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  tagline: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
