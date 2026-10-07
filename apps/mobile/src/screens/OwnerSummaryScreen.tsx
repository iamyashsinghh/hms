import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isoDate, rupees } from '@/data/dates';
import { data } from '@/lib/data';
import { useLoad } from '@/lib/useLoad';
import { Card, ErrorText, colors, space } from '@/ui';
import { DateSwitcher, DemoBanner, EmptyState, SectionTitle, Stat } from '@/ui/widgets';

/** Owner app: the day's OPD visits, new patients, collections and top doctors (reports module). */
export function OwnerSummaryScreen() {
  const [date, setDate] = useState(isoDate);
  const state = useLoad(() => data.ownerSummary(date), date, { pollMs: date === isoDate() ? 60_000 : undefined });
  const sum = state.data;
  const maxRevenue = Math.max(1, ...(sum?.topDoctors ?? []).map((d) => d.revenue));

  return (
    <ScrollView contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={state.reload} />}>
      <DateSwitcher date={date} onChange={setDate} />
      <DemoBanner visible={state.demo} />
      {state.loading ? <ActivityIndicator color={colors.primary} /> : null}
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
      {sum ? (
        <>
          <View style={s.grid}>
            <Stat label="Collections" value={rupees(sum.collections)} />
            <Stat label="OPD visits" value={String(sum.opdVisits)} />
            <Stat label="New patients" value={String(sum.newPatients)} />
            <Stat label="Pending bills" value={String(sum.pendingBills)} />
          </View>
          <SectionTitle>Top doctors</SectionTitle>
          {sum.topDoctors.length === 0 ? (
            <EmptyState icon="stats-chart-outline" title="No consultations yet" />
          ) : (
            <Card style={{ gap: space.md }}>
              {sum.topDoctors.map((d) => (
                <View key={d.doctorId} style={{ gap: 4 }}>
                  <View style={s.docRow}>
                    <Text style={s.docName} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Text style={s.docValue}>{rupees(d.revenue)}</Text>
                  </View>
                  <View style={s.barTrack}>
                    <View style={[s.bar, { width: `${Math.round((d.revenue / maxRevenue) * 100)}%` }]} />
                  </View>
                  <Text style={s.muted}>
                    {d.visits} visit{d.visits === 1 ? '' : 's'}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  docRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  docValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  muted: { fontSize: 12, color: colors.muted },
});
