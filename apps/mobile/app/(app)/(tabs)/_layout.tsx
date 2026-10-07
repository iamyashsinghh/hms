import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useAuth } from '@/lib/auth';
import { colors } from '@/ui';
import { variant, type ShellTab } from '@/variants';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: Record<ShellTab, { route: string; title: string; header?: string; icon: IconName }> = {
  queue: { route: 'queue', title: 'Queue', header: "Today's OPD queue", icon: 'list-outline' },
  opd: { route: 'opd', title: 'OPD', header: 'OPD queue', icon: 'list-outline' },
  summary: { route: 'summary', title: 'Summary', header: 'Daily summary', icon: 'stats-chart-outline' },
  home: { route: 'index', title: 'Home', icon: 'home-outline' },
  patients: { route: 'patients', title: 'Patients', icon: 'people-outline' },
  profile: { route: 'profile', title: 'Profile', icon: 'person-circle-outline' },
};

/** Tabs in the order the variant lists them; tabs the variant does not use are registered but hidden. */
export default function TabsLayout() {
  const { can } = useAuth();
  const visible = (tab: ShellTab) => variant.tabs.includes(tab) && (tab !== 'patients' || can('core.patient.read'));
  const order = [...variant.tabs, ...(Object.keys(TABS) as ShellTab[]).filter((t) => !variant.tabs.includes(t))];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {order.map((tab) => {
        const t = TABS[tab];
        return (
          <Tabs.Screen
            key={tab}
            name={t.route}
            options={{
              title: t.title,
              headerTitle: tab === 'home' ? variant.title : (t.header ?? t.title),
              href: visible(tab) ? undefined : null,
              tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} color={color} size={size} />,
            }}
          />
        );
      })}
    </Tabs>
  );
}
