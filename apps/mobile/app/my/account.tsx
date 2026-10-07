import Constants from 'expo-constants';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '@/lib/config';
import { usePatientAuth } from '@/lib/patient-auth';
import { Button, Card, colors, space } from '@/ui';
import { variant } from '@/variants';

export default function MyAccount() {
  const { profile, logout } = usePatientAuth();
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView contentContainerStyle={s.container}>
      <Card>
        <Text style={s.name}>{profile?.name ?? 'Patient'}</Text>
        {profile?.mobile ? <Row label="Mobile" value={profile.mobile} /> : null}
        {profile?.hospitalName ? <Row label="Hospital" value={profile.hospitalName} /> : null}
      </Card>
      {profile && profile.members.length > 0 ? (
        <Card>
          <Text style={s.heading}>Patients on this account</Text>
          {profile.members.map((m) => (
            <Row key={m.id} label={m.relation === 'self' ? 'You' : m.relation} value={`${m.name} · ${m.uhid}`} />
          ))}
        </Card>
      ) : null}
      <Card>
        <Row label="App" value={`${variant.title} ${Constants.expoConfig?.version ?? ''}`} />
        <Row label="Server" value={API_URL} />
      </Card>
      <Button
        title="Sign out"
        variant="danger"
        loading={busy}
        onPress={() => {
          setBusy(true);
          void logout().finally(() => setBusy(false));
        }}
      />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  heading: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  label: { fontSize: 14, color: colors.muted },
  value: { fontSize: 14, color: colors.text, flexShrink: 1, textAlign: 'right' },
});
