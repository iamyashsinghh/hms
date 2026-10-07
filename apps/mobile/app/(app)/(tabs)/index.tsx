import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { availableScreens } from '@/modules';
import { Card, Chip, colors, greeting, radius, roleLabel, space } from '@/ui';
import { variant } from '@/variants';

export default function HomeScreen() {
  const { user, facilityId, can } = useAuth();
  if (!user) return null;

  const facility = user.facilities.find((f) => f.id === facilityId);
  const screens = availableScreens(variant.key, user.permissions, user.roles);
  const builtIn = [
    variant.tabs.includes('patients') && can('core.patient.read')
      ? { title: 'Patients', description: 'Search patients by name, UHID or mobile', route: '/patients' }
      : null,
  ].filter((x) => x !== null);

  return (
    <ScrollView contentContainerStyle={s.container}>
      <View style={s.hero}>
        <Text style={s.hello}>{greeting()},</Text>
        <Text style={s.name}>{user.name}</Text>
        <Text style={s.hospital}>
          {user.tenantName}
          {facility ? ` · ${facility.name}` : ''}
        </Text>
        <View style={s.roles}>
          {user.roles.map((r) => (
            <View key={r} style={s.roleChip}>
              <Text style={s.roleText}>{roleLabel(r)}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={s.section}>Features</Text>
      {[...builtIn, ...screens].map((f) => (
        <Pressable key={f.route} onPress={() => router.push(f.route as Href)}>
          {({ pressed }) => (
            <Card style={[s.feature, pressed && { opacity: 0.7 }]}>
              <View style={s.featureIcon}>
                <Ionicons name="grid-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.featureTitle}>{f.title}</Text>
                {f.description ? <Text style={s.muted}>{f.description}</Text> : null}
                {'module' in f ? <Chip label={f.module} tone="accent" /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          )}
        </Pressable>
      ))}
      {builtIn.length + screens.length === 0 ? (
        <Card>
          <Text style={s.featureTitle}>Nothing here yet</Text>
          <Text style={s.muted}>Features enabled for your role in {variant.title} will appear here.</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.xs,
    borderBottomWidth: 4,
    borderBottomColor: colors.accent,
  },
  hello: { color: colors.primarySoft, fontSize: 15 },
  name: { color: colors.white, fontSize: 24, fontWeight: '700' },
  hospital: { color: colors.primarySoft, fontSize: 14 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  roleChip: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  roleText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: space.sm },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
});
