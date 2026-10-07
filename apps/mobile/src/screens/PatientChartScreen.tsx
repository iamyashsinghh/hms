import Ionicons from '@expo/vector-icons/Ionicons';
import type { Patient } from '@hms/shared';
import { Stack, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dateTimeLabel } from '@/data/dates';
import { ageLabel } from '@/data/normalize';
import type { QueueStatus, TimelineEntry, TimelineType } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { data } from '@/lib/data';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Chip, ErrorText, colors, radius, space } from '@/ui';
import { Avatar, DemoBanner, EmptyState, SectionTitle } from '@/ui/widgets';
import { VisitActions } from './VisitActions';

const ICONS: Record<TimelineType, ComponentProps<typeof Ionicons>['name']> = {
  encounter: 'medkit-outline',
  prescription: 'document-text-outline',
  vitals: 'pulse-outline',
  lab: 'flask-outline',
  radiology: 'scan-outline',
  bill: 'receipt-outline',
  note: 'create-outline',
  other: 'ellipse-outline',
};

/** Patient header (demographics, allergies) + EMR timeline, with "Write prescription" for doctors. */
export function PatientChartScreen({
  patientId,
  encounterId,
  visit,
}: {
  patientId: string;
  encounterId?: string;
  visit?: { id: string; status: QueueStatus; tokenNo: number | null };
}) {
  const { user, can } = useAuth();
  const patient = useLoad(() => data.patient(patientId), patientId);
  const timeline = useLoad(() => data.timeline(patientId), patientId);
  const canPrescribe = can('emr.prescription.write') || !!user?.roles.includes('doctor');

  const p = patient.data;
  const name = p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';

  return (
    <>
      <Stack.Screen options={{ title: name || 'Patient' }} />
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={
          <RefreshControl
            refreshing={patient.refreshing || timeline.refreshing}
            onRefresh={() => {
              patient.reload();
              timeline.reload();
            }}
          />
        }
      >
        <DemoBanner visible={patient.demo || timeline.demo} />
        {patient.loading ? <ActivityIndicator color={colors.primary} /> : null}
        {patient.error ? <ErrorText>{patient.error}</ErrorText> : null}
        {p ? <PatientHeader patient={p} name={name} /> : null}
        {visit ? <VisitActions visit={visit} encounterId={encounterId} /> : null}

        {p && canPrescribe ? (
          <Button
            title="Write prescription"
            onPress={() =>
              router.push({
                pathname: '/emr/rx/[patientId]',
                params: { patientId, ...(encounterId ? { encounterId } : {}) },
              })
            }
          />
        ) : null}

        <SectionTitle>Timeline</SectionTitle>
        {timeline.loading ? <ActivityIndicator color={colors.primary} /> : null}
        {timeline.error ? <ErrorText>{timeline.error}</ErrorText> : null}
        {timeline.data && timeline.data.length === 0 ? (
          <EmptyState icon="time-outline" title="No earlier visits" body="Past visits, prescriptions and reports show here." />
        ) : null}
        {(timeline.data ?? []).map((e, i, all) => (
          <TimelineRow key={e.id} entry={e} last={i === all.length - 1} />
        ))}
      </ScrollView>
    </>
  );
}

function PatientHeader({ patient: p, name }: { patient: Patient; name: string }) {
  const age = ageLabel(p.dateOfBirth, p.ageYears ?? null);
  const meta = [p.gender !== 'unknown' ? p.gender : null, age].filter(Boolean).join(', ');
  const allergies = p.allergies ?? [];
  return (
    <Card>
      <View style={s.headRow}>
        <Avatar name={name} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.name}>{name}</Text>
          <Text style={s.muted}>{[p.uhid, meta].filter(Boolean).join(' · ')}</Text>
          {p.mobile ? <Text style={s.muted}>{p.mobile}</Text> : null}
        </View>
        {p.bloodGroup ? <Chip label={p.bloodGroup} tone="accent" /> : null}
      </View>
      <View style={[s.allergy, allergies.length === 0 && s.allergyNone]}>
        <Ionicons
          name={allergies.length ? 'warning-outline' : 'checkmark-circle-outline'}
          size={16}
          color={allergies.length ? colors.danger : colors.success}
        />
        <Text style={[s.allergyText, { color: allergies.length ? colors.danger : colors.success }]}>
          {allergies.length ? `Allergies: ${allergies.join(', ')}` : 'No known allergies recorded'}
        </Text>
      </View>
    </Card>
  );
}

function TimelineRow({ entry: e, last }: { entry: TimelineEntry; last: boolean }) {
  return (
    <View style={s.tlRow}>
      <View style={s.tlRail}>
        <View style={s.tlDot}>
          <Ionicons name={ICONS[e.type]} size={16} color={colors.primary} />
        </View>
        {!last ? <View style={s.tlLine} /> : null}
      </View>
      <Card style={s.tlCard}>
        <View style={s.tlTop}>
          <Text style={s.tlTitle}>{e.title}</Text>
          <Text style={s.tlDate}>{dateTimeLabel(e.at)}</Text>
        </View>
        {e.summary ? <Text style={s.tlSummary}>{e.summary}</Text> : null}
        {e.details.map((d, i) => (
          <Text key={i} style={s.tlDetail}>
            {d}
          </Text>
        ))}
        {e.doctorName ? <Text style={s.muted}>{e.doctorName}</Text> : null}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  allergy: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  allergyNone: { backgroundColor: colors.successSoft },
  allergyText: { fontSize: 14, fontWeight: '600', flex: 1 },
  tlRow: { flexDirection: 'row', gap: space.sm },
  tlRail: { width: 32, alignItems: 'center' },
  tlDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  tlCard: { flex: 1, padding: space.md, gap: 4, marginBottom: space.sm },
  tlTop: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  tlTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  tlDate: { fontSize: 12, color: colors.muted },
  tlSummary: { fontSize: 14, color: colors.text, lineHeight: 20 },
  tlDetail: { fontSize: 13, color: colors.text, lineHeight: 18 },
});
