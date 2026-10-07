import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { timeLabel } from '@/data/dates';
import type { QueueItem } from '@/data/types';
import type { LoadState } from '@/lib/useLoad';
import { Card, ErrorText, colors, radius, space } from '@/ui';
import { DemoBanner, EmptyState, StatusPill } from '@/ui/widgets';

/** Token queue list used by the doctor's queue and the front-office queue. */
export function QueueList({
  state,
  header,
  onOpen,
  emptyTitle,
}: {
  state: LoadState<QueueItem[]>;
  header: ReactElement;
  onOpen?: (item: QueueItem) => void;
  emptyTitle: string;
}) {
  const items = state.data ?? [];
  const waiting = items.filter((i) => i.status === 'waiting').length;
  const done = items.filter((i) => i.status === 'completed').length;

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={state.reload} />}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {header}
          <DemoBanner visible={state.demo} />
          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
          {items.length > 0 ? (
            <View style={s.counts}>
              <Count n={items.length} label="Total" />
              <Count n={waiting} label="Waiting" />
              <Count n={done} label="Done" />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        state.loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: space.xl }} />
        ) : state.error ? null : (
          <EmptyState icon="people-outline" title={emptyTitle} body="Pull down to refresh." />
        )
      }
      renderItem={({ item }) => <QueueRow item={item} onPress={onOpen ? () => onOpen(item) : undefined} />}
    />
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <View style={s.count}>
      <Text style={s.countN}>{n}</Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

function QueueRow({ item, onPress }: { item: QueueItem; onPress?: () => void }) {
  const meta = [item.gender && item.gender !== 'unknown' ? item.gender[0]?.toUpperCase() : null, item.age]
    .filter(Boolean)
    .join(' / ');
  const time = timeLabel(item.at);
  const faded = item.status === 'completed' || item.status === 'cancelled' || item.status === 'no_show' || item.status === 'skipped';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}>
      {({ pressed }) => (
        <Card style={[s.row, item.status === 'in_consultation' && s.rowActive, (pressed || faded) && { opacity: faded ? 0.6 : 0.75 }]}>
          <View style={s.token}>
            <Text style={s.tokenLabel}>TOKEN</Text>
            <Text style={s.tokenNo}>{item.tokenNo ?? '–'}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.name} numberOfLines={1}>
              {item.patientName}
              {meta ? <Text style={s.muted}>{`  ${meta}`}</Text> : null}
            </Text>
            <Text style={s.muted} numberOfLines={1}>
              {[item.uhid, time ? `in ${time}` : null, item.doctorName].filter(Boolean).join(' · ')}
            </Text>
            <StatusPill status={item.status} />
          </View>
          {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
        </Card>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  counts: { flexDirection: 'row', gap: space.sm },
  count: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  countN: { fontSize: 20, fontWeight: '800', color: colors.text },
  countLabel: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  rowActive: { borderColor: colors.primary, borderWidth: 1.5 },
  token: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenLabel: { fontSize: 9, fontWeight: '700', color: colors.primaryDark, letterSpacing: 0.5 },
  tokenNo: { fontSize: 22, fontWeight: '800', color: colors.primary },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, fontWeight: '400' },
});
