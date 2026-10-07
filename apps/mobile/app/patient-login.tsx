import { ApiError } from '@hms/api-client';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/config';
import { DEMO_OTP, usePatientAuth } from '@/lib/patient-auth';
import { Button, Card, ErrorText, Field, colors, space } from '@/ui';
import { DemoBanner } from '@/ui/widgets';
import { variant } from '@/variants';

const MOBILE = /^[6-9]\d{9}$/;

/** Patient app sign-in: hospital code + mobile number, then a one-time password by SMS/WhatsApp. */
export default function PatientLoginScreen() {
  const { status, requestOtp, verifyOtp, bootError } = usePatientAuth();
  const [tenantCode, setTenantCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedIn') return <Redirect href="/my" />;

  async function sendOtp() {
    setError(null);
    const code = tenantCode.trim().toLowerCase();
    if (code.length < 2) return setError('Enter your hospital code');
    if (!MOBILE.test(mobile)) return setError('Enter your 10-digit mobile number');
    setBusy(true);
    try {
      const res = await requestOtp(code, mobile);
      setDemo(res === 'demo');
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error && !(err instanceof TypeError) ? err.message : `Cannot reach the server (${API_URL})`);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(null);
    if (!/^\d{4,8}$/.test(otp)) return setError('Enter the OTP you received');
    setBusy(true);
    try {
      await verifyOtp(tenantCode.trim().toLowerCase(), mobile, otp, demo);
    } catch (err) {
      setError(err instanceof ApiError && (err.status === 401 || err.status === 400) ? 'Wrong or expired OTP' : err instanceof Error ? err.message : String(err));
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
            {step === 'mobile' ? (
              <>
                <Field label="Hospital code" value={tenantCode} onChangeText={setTenantCode} placeholder="Printed on your OPD slip, e.g. demo" autoCapitalize="none" autoCorrect={false} />
                <Field label="Mobile number" value={mobile} onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))} placeholder="98XXXXXXXX" keyboardType="phone-pad" textContentType="telephoneNumber" />
                {error ? <ErrorText>{error}</ErrorText> : null}
                {!error && bootError ? <ErrorText>Could not restore your session: {bootError}</ErrorText> : null}
                <Button title="Send OTP" onPress={() => void sendOtp()} loading={busy} />
              </>
            ) : (
              <>
                <DemoBanner visible={demo} />
                <Text style={s.sent}>{demo ? `Demo mode: use OTP ${DEMO_OTP}` : `OTP sent to ${mobile}`}</Text>
                <Field label="OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 8))} placeholder="6-digit code" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" />
                {error ? <ErrorText>{error}</ErrorText> : null}
                <Button title="Verify and continue" onPress={() => void confirm()} loading={busy} />
                <Button title="Change number" variant="outline" onPress={() => { setStep('mobile'); setOtp(''); setError(null); }} />
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  brand: { alignItems: 'center', gap: space.sm },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderBottomColor: colors.accent },
  logoText: { color: colors.white, fontSize: 30, fontWeight: '800' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  tagline: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  sent: { fontSize: 14, color: colors.text },
});
