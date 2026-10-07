import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dayLabel, isoDate } from '@/data/dates';
import type { QueueStatus } from '@/data/types';
import { colors, radius, space } from './theme';

/** Shown above any list or summary filled from built-in demo data. */
export function DemoBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={s.demo}>
      <Ionicons name="flask-outline" size={16} color={colors.warning} />
      <Text style={s.demoText}>Demo data: this feature is not on the server yet.</Text>
    </View>
  );
}

const STATUS: Record<QueueStatus, { label: string; fg: string; bg: string }> = {
  waiting: { label: 'Waiting', fg: colors.warning, bg: colors.warningSoft },
  called: { label: 'Called', fg: colors.accent, bg: colors.accentSoft },
  in_consultation: { label: 'With doctor', fg: colors.primaryDark, bg: colors.primarySoft },
  skipped: { label: 'Skipped', fg: colors.muted, bg: colors.border },
  completed: { label: 'Done', fg: colors.success, bg: colors.successSoft },
  cancelled: { label: 'Cancelled', fg: colors.muted, bg: colors.border },
  no_show: { label: 'No show', fg: colors.muted, bg: colors.border },
};

export function StatusPill({ status }: { status: QueueStatus }) {
  const st = STATUS[status];
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text>
    </View>
  );
}

export function DateSwitcher({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = isoDate();
  return (
    <View style={s.dateRow}>
      <IconButton icon="chevron-back" label="Previous day" onPress={() => onChange(addDays(date, -1))} />
      <Pressable onPress={() => onChange(today)} style={s.dateMid} accessibilityRole="button" accessibilityLabel="Go to today">
        <Text style={s.dateText}>{dayLabel(date, today)}</Text>
        {date !== today ? <Text style={s.dateHint}>Tap for today</Text> : null}
      </Pressable>
      <IconButton icon="chevron-forward" label="Next day" onPress={() => onChange(addDays(date, 1))} />
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; body?: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={36} color={colors.muted} />
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={s.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.4 }]}>{name.trim().slice(0, 1).toUpperCase() || '?'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  demoText: { color: colors.warning, fontSize: 13, fontWeight: '600', flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.xs,
  },
  dateMid: { flex: 1, alignItems: 'center', paddingVertical: space.xs },
  dateText: { fontSize: 16, fontWeight: '700', color: colors.text },
  dateHint: { fontSize: 11, color: colors.muted },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: 2,
  },
  statLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  statValue: { fontSize: 26, color: colors.text, fontWeight: '800' },
  statHint: { fontSize: 12, color: colors.muted },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '700' },
});
