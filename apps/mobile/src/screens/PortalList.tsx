import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';
import { dateTimeLabel, rupees } from '@/data/dates';
import type { PortalRecord } from '@/data/types';
import { patientData } from '@/lib/patient-data';
import { useLoad } from '@/lib/useLoad';
import { Card, Chip, ErrorText, colors, space } from '@/ui';
import { DemoBanner, EmptyState, SectionTitle } from '@/ui/widgets';

export function PortalList({
  kinds,
  emptyIcon,
}: {
  kinds: { kind: 'appointments' | 'prescriptions' | 'bills'; title: string; empty: string }[];
  emptyIcon: ComponentProps<typeof Ionicons>['name'];
}) {
  const state = useLoad(async () => {
    const results = await Promise.all(kinds.map((k) => patientData.portalList(k.kind)));
    return {
      data: results.map((r, i) => ({ ...kinds[i]!, items: r.data })),
      demo: results.some((r) => r.demo),
    };
  }, kinds.map((k) => k.kind).join(','));

  const sections = state.data ?? [];
  return (
    <FlatList
      data={sections}
      keyExtractor={(s) => s.kind}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={state.reload} />}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <DemoBanner visible={state.demo} />
          {state.loading ? <ActivityIndicator color={colors.primary} /> : null}
          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        </View>
      }
      renderItem={({ item: section }) => (
        <View style={{ gap: space.sm }}>
          {kinds.length > 1 ? <SectionTitle>{section.title}</SectionTitle> : null}
          {section.items.length === 0 ? <EmptyState icon={emptyIcon} title={section.empty} /> : section.items.map((r) => <Row key={r.id} r={r} />)}
        </View>
      )}
    />
  );
}

function Row({ r }: { r: PortalRecord }) {
  return (
    <Card style={{ gap: 4 }}>
      <View style={s.top}>
        <Text style={s.title} numberOfLines={1}>
          {r.title}
        </Text>
        {r.amount !== null ? <Text style={s.amount}>{rupees(r.amount)}</Text> : null}
      </View>
      {r.subtitle ? <Text style={s.muted}>{r.subtitle}</Text> : null}
      <View style={s.top}>
        <Text style={s.muted}>{dateTimeLabel(r.at)}</Text>
        {r.status ? <Chip label={r.status.replace(/_/g, ' ')} /> : null}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  amount: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
});
