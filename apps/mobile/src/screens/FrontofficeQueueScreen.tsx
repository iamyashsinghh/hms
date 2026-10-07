import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isoDate } from '@/data/dates';
import type { DoctorRef } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { data } from '@/lib/data';
import { errorMessage, useLoad } from '@/lib/useLoad';
import { ErrorText, colors, radius, space } from '@/ui';
import { DateSwitcher } from '@/ui/widgets';
import { QueueList } from './QueueList';

/** Staff app: the token queue for one doctor and day (front office module). */
export function FrontofficeQueueScreen() {
  const { can } = useAuth();
  const [date, setDate] = useState(isoDate);
  const [doctors, setDoctors] = useState<DoctorRef[]>([]);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);

  useEffect(() => {
    data
      .doctors()
      .then((res) => {
        setDoctors(res.data);
        setDoctorId((cur) => cur ?? res.data[0]?.userId ?? null);
      })
      .catch((err: unknown) => setDoctorsError(errorMessage(err)));
  }, []);

  const state = useLoad(
    () => (doctorId ? data.frontofficeQueue(doctorId, date) : Promise.resolve({ data: [], demo: false })),
    `${doctorId}:${date}`,
    { pollMs: date === isoDate() ? 30_000 : undefined },
  );

  return (
    <QueueList
      state={state}
      emptyTitle={doctorId ? 'No patients in this queue' : 'Choose a doctor'}
      onOpen={can('core.patient.read') ? (item) => router.push({ pathname: '/emr/patient/[id]', params: { id: item.patientId } }) : undefined}
      header={
        <View style={{ gap: space.md }}>
          <DateSwitcher date={date} onChange={setDate} />
          {doctorsError ? <ErrorText>{doctorsError}</ErrorText> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {doctors.map((d) => {
              const active = d.userId === doctorId;
              return (
                <Pressable key={d.userId} onPress={() => setDoctorId(d.userId)} style={[s.doc, active && s.docActive]}>
                  <Text style={[s.docName, active && { color: colors.white }]}>{d.name}</Text>
                  {d.specialization ? <Text style={[s.docSpec, active && { color: colors.primarySoft }]}>{d.specialization}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      }
    />
  );
}

const s = StyleSheet.create({
  doc: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  docActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  docName: { fontSize: 14, fontWeight: '700', color: colors.text },
  docSpec: { fontSize: 12, color: colors.muted },
});
