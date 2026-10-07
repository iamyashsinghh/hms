import { router } from 'expo-router';
import { useState } from 'react';
import { isoDate } from '@/data/dates';
import { useAuth } from '@/lib/auth';
import { data } from '@/lib/data';
import { useLoad } from '@/lib/useLoad';
import { DateSwitcher } from '@/ui/widgets';
import { QueueList } from './QueueList';

/** Doctor app: checked-in patients for the day, refreshed every 30 s. Tap a patient to open their chart. */
export function DoctorQueueScreen() {
  const { user } = useAuth();
  const [date, setDate] = useState(isoDate);
  const userId = user?.id ?? '';
  const state = useLoad(() => data.doctorQueue(date, userId), `${userId}:${date}`, {
    pollMs: date === isoDate() ? 30_000 : undefined,
  });

  return (
    <QueueList
      state={state}
      header={<DateSwitcher date={date} onChange={setDate} />}
      emptyTitle="No checked-in patients for this day"
      onOpen={(item) =>
        router.push({
          pathname: '/emr/patient/[id]',
          params: {
            id: item.patientId,
            ...(item.encounterId ? { encounterId: item.encounterId } : {}),
            ...(item.visitId ? { visitId: item.visitId, visitStatus: item.status, token: String(item.tokenNo ?? '') } : {}),
          },
        })
      }
    />
  );
}
