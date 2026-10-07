import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isoDate, rupees, vsYesterday } from '@/data/dates';
import { data } from '@/lib/data';
import { useLoad } from '@/lib/useLoad';
import { Card, ErrorText, colors, space } from '@/ui';
import { DateSwitcher, DemoBanner, EmptyState, SectionTitle, Stat } from '@/ui/widgets';

const MODE_LABELS: Record<string, string> = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', cheque: 'Cheque', online: 'Online' };

/** Owner app: the day's collections, OPD visits, new patients, pending bills, top doctors and services. */
export function OwnerSummaryScreen() {
  const [date, setDate] = useState(isoDate);
  const state = useLoad(() => data.ownerSummary(date), date, { pollMs: date === isoDate() ? 60_000 : undefined });
  const sum = state.data;
  const prev = sum?.previous ?? undefined;
  const maxRevenue = Math.max(1, ...(sum?.topDoctors ?? []).map((d) => d.revenue));
  const modeTotal = Math.max(1, ...(sum ? [sum.collectionsByMode.reduce((a, m) => a + m.amount, 0)] : [1]));

  return (
    <ScrollView contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={state.reload} />}>
      <DateSwitcher date={date} onChange={setDate} />
      <DemoBanner visible={state.demo} />
      {state.loading ? <ActivityIndicator color={colors.primary} /> : null}
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
      {sum ? (
        <>
          <View style={s.grid}>
            <Stat label="Collections" value={rupees(sum.collections)} hint={vsYesterday(sum.collections, prev?.collections, true)} />
            <Stat label="OPD visits" value={String(sum.opdVisits)} hint={vsYesterday(sum.opdVisits, prev?.opdVisits)} />
            <Stat label="New patients" value={String(sum.newPatients)} hint={vsYesterday(sum.newPatients, prev?.newPatients)} />
            <Stat
              label="Pending bills"
              value={String(sum.pendingBills.count)}
              hint={sum.pendingBills.amount > 0 ? `${rupees(sum.pendingBills.amount)} due` : undefined}
            />
          </View>
          {sum.billed > 0 || sum.consultationsSigned > 0 ? (
            <Card style={s.inline}>
              <Text style={s.muted}>Billed {rupees(sum.billed)}</Text>
              <Text style={s.muted}>Consultations signed {sum.consultationsSigned}</Text>
            </Card>
          ) : null}

          {sum.collectionsByMode.length > 0 ? (
            <>
              <SectionTitle>Collections by mode</SectionTitle>
              <Card style={{ gap: space.md }}>
                {sum.collectionsByMode.map((m) => (
                  <Bar key={m.mode} label={MODE_LABELS[m.mode] ?? m.mode} value={rupees(m.amount)} ratio={m.amount / modeTotal} />
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle>Top doctors</SectionTitle>
          {sum.topDoctors.length === 0 ? (
            <EmptyState icon="stats-chart-outline" title="No consultations yet" />
          ) : (
            <Card style={{ gap: space.md }}>
              {sum.topDoctors.map((d) => (
                <Bar
                  key={d.doctorId}
                  label={d.name}
                  value={rupees(d.revenue)}
                  ratio={d.revenue / maxRevenue}
                  hint={`${d.visits} visit${d.visits === 1 ? '' : 's'}`}
                />
              ))}
            </Card>
          )}

          {sum.topServices.length > 0 ? (
            <>
              <SectionTitle>Top services</SectionTitle>
              <Card style={{ gap: space.sm }}>
                {sum.topServices.map((x) => (
                  <View key={x.description} style={s.row}>
                    <Text style={s.name} numberOfLines={1}>
                      {x.description} <Text style={s.muted}>× {x.qty}</Text>
                    </Text>
                    <Text style={s.value}>{rupees(x.amount)}</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Bar({ label, value, ratio, hint }: { label: string; value: string; ratio: number; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={s.row}>
        <Text style={s.name} numberOfLines={1}>
          {label}
        </Text>
        <Text style={s.value}>{value}</Text>
      </View>
      <View style={s.barTrack}>
        <View style={[s.bar, { width: `${Math.max(2, Math.round(ratio * 100))}%` }]} />
      </View>
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inline: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', paddingVertical: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  value: { fontSize: 15, fontWeight: '700', color: colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  muted: { fontSize: 12, color: colors.muted },
});
