import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { QueueStatus, VisitAction } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { data } from '@/lib/data';
import { errorMessage } from '@/lib/useLoad';
import { Button, Card, ErrorText, colors, space } from '@/ui';
import { StatusPill } from '@/ui/widgets';

const ACTIONS: Partial<Record<QueueStatus, { action: VisitAction; title: string; variant?: 'outline' }[]>> = {
  waiting: [
    { action: 'call', title: 'Call patient' },
    { action: 'start', title: 'Start consultation', variant: 'outline' },
    { action: 'skip', title: 'Skip', variant: 'outline' },
  ],
  called: [
    { action: 'start', title: 'Start consultation' },
    { action: 'skip', title: 'Not here, skip', variant: 'outline' },
  ],
  in_consultation: [{ action: 'complete', title: 'Complete consultation' }],
  skipped: [{ action: 'requeue', title: 'Put back in queue', variant: 'outline' }],
};

/** Token card on the patient chart: moves the front-office visit through the queue. */
export function VisitActions({ visit, encounterId }: { visit: { id: string; status: QueueStatus; tokenNo: number | null }; encounterId?: string }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<QueueStatus>(visit.status);
  const [busy, setBusy] = useState<VisitAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('frontoffice.queue.manage');
  const actions = allowed && !visit.id.startsWith('demo-') ? (ACTIONS[status] ?? []) : [];

  async function run(action: VisitAction) {
    setBusy(action);
    setError(null);
    try {
      await data.visitAction(visit.id, action);
      if (action === 'start' && encounterId) await data.startEncounter(encounterId);
      setStatus(
        action === 'call' ? 'called' : action === 'start' ? 'in_consultation' : action === 'complete' ? 'completed' : action === 'skip' ? 'skipped' : action === 'requeue' ? 'waiting' : 'cancelled',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={{ gap: space.md }}>
      <View style={s.row}>
        <Text style={s.token}>Token {visit.tokenNo ?? '–'}</Text>
        <StatusPill status={status} />
      </View>
      {actions.map((a) => (
        <Button key={a.action} title={a.title} variant={a.variant} loading={busy === a.action} disabled={busy !== null} onPress={() => void run(a.action)} />
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  token: { fontSize: 18, fontWeight: '800', color: colors.text },
});
