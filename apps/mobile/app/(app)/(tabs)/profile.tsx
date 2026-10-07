import Constants from 'expo-constants';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { Button, Card, Chip, colors, roleLabel, space } from '@/ui';
import { variant } from '@/variants';

export default function ProfileScreen() {
  const { user, logout, facilityId, selectFacility } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Card>
        <Text style={s.name}>{user.name}</Text>
        {user.email ? <Row label="Email" value={user.email} /> : null}
        {user.mobile ? <Row label="Mobile" value={user.mobile} /> : null}
        <Row label="Hospital" value={`${user.tenantName} (${user.tenantCode})`} />
        <View style={s.chips}>
          {user.roles.map((r) => (
            <Chip key={r} label={roleLabel(r)} />
          ))}
        </View>
      </Card>

      {user.facilities.length > 0 ? (
        <Card>
          <Text style={s.heading}>Facility</Text>
          {user.facilities.map((f) => {
            const active = f.id === facilityId;
            return (
              <Pressable key={f.id} onPress={() => selectFacility(f.id)} style={[s.facility, active && s.facilityActive]}>
                <Text style={[s.value, active && { color: colors.primary, fontWeight: '700' }]}>{f.name}</Text>
                <Text style={s.label}>{f.code}</Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      <Card>
        <Text style={s.heading}>App</Text>
        <Row label="App" value={`${variant.title} ${Constants.expoConfig?.version ?? ''}`} />
        <Row label="Server" value={API_URL} />
        <Row label="Permissions" value={String(user.permissions.length)} />
      </Card>

      <Button
        title="Sign out"
        variant="danger"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await logout();
          } finally {
            setBusy(false);
          }
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  facility: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  facilityActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
