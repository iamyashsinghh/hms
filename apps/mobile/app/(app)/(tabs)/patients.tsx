import type { Patient } from '@hms/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';
import { Card, Centered, ErrorText, ageFrom, colors, radius, space } from '@/ui';

const PAGE_SIZE = 25;

export default function PatientsScreen() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Patient[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const allowed = can('core.patient.read');

  const load = useCallback(async (query: string, nextPage: number) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.patients.list({ q: query.trim() || undefined, page: nextPage, pageSize: PAGE_SIZE });
      if (id !== requestId.current) return;
      setItems((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items]));
      setPage(res.page);
      setTotal(res.total);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(() => void load(q, 1), 300);
    return () => clearTimeout(t);
  }, [q, load, allowed]);

  if (!allowed) {
    return (
      <Centered>
        <Text style={s.muted}>You do not have access to patient records.</Text>
      </Centered>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search name, UHID or mobile"
          placeholderTextColor={colors.muted}
          style={s.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <Text style={s.count}>{total} patient{total === 1 ? '' : 's'}</Text>
      </View>
      {error ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => load(q, 1)} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loading && items.length < total) void load(q, page + 1);
        }}
        ListEmptyComponent={
          loading ? null : <Text style={[s.muted, { textAlign: 'center', marginTop: space.xl }]}>No patients found</Text>
        }
        ListFooterComponent={loading && page > 0 && items.length > 0 ? <ActivityIndicator color={colors.primary} /> : null}
        renderItem={({ item }) => <PatientRow patient={item} />}
      />
    </View>
  );
}

function PatientRow({ patient: p }: { patient: Patient }) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const age = ageFrom(p.dateOfBirth, p.ageYears);
  const meta = [p.gender !== 'unknown' ? p.gender[0]?.toUpperCase() : null, age].filter(Boolean).join(' / ');
  return (
    <Card style={s.row}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.name}>
          {name}
          {meta ? <Text style={s.muted}>{`  ${meta}`}</Text> : null}
        </Text>
        <Text style={s.muted}>
          {p.uhid}
          {p.mobile ? ` · ${p.mobile}` : ''}
        </Text>
      </View>
      {p.bloodGroup ? <Text style={s.blood}>{p.bloodGroup}</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  searchWrap: { padding: space.lg, paddingBottom: space.sm, gap: space.xs },
  search: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.text,
  },
  count: { fontSize: 12, color: colors.muted },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, fontWeight: '400' },
  blood: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
