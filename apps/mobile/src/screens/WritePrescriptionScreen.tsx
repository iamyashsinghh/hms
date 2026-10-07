import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FREQUENCIES, allergyHits, buildPrescription, emptyLine, suggestQty, type RxDraftLine } from '@/data/rx';
import { data } from '@/lib/data';
import { loadFavourites, removeFavourite, saveFavourite, type Favourite } from '@/lib/favourites';
import { errorMessage, useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorText, Field, colors, radius, space } from '@/ui';
import { DemoBanner, IconButton, SectionTitle } from '@/ui/widgets';

/** E-prescription (doctor app lite): medicines with Indian dosing shorthand, favourites, allergy check. */
export function WritePrescriptionScreen({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const patient = useLoad(() => data.patient(patientId), patientId);
  const allergies = patient.data?.allergies ?? [];
  const name = patient.data ? [patient.data.firstName, patient.data.lastName].filter(Boolean).join(' ') : '';

  const [lines, setLines] = useState<RxDraftLine[]>([emptyLine()]);
  const [advice, setAdvice] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [favourites, setFavourites] = useState<Favourite[]>([]);

  useEffect(() => {
    void loadFavourites().then(setFavourites);
  }, []);

  const update = (i: number, patch: Partial<RxDraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function addFavourite(f: Favourite) {
    setLines((prev) => {
      const blankIdx = prev.findIndex((l) => !l.drugName.trim());
      const line = { ...emptyLine(), ...f };
      return blankIdx >= 0 ? prev.map((l, i) => (i === blankIdx ? line : l)) : [...prev, line];
    });
  }

  async function submit() {
    const result = buildPrescription({ patientId, encounterId, lines, advice, followUpDate });
    setErrors(result.errors);
    if (!result.ok || !result.body) return;
    const body = result.body;
    const hits = [...new Set(body.lines.flatMap((l) => allergyHits(l.drugName, allergies)))];
    const send = async () => {
      setBusy(true);
      try {
        await data.createPrescription(body);
        Alert.alert('Prescription saved', `${body.lines.length} medicine${body.lines.length === 1 ? '' : 's'} prescribed for ${name || 'the patient'}.`);
        router.back();
      } catch (err) {
        setErrors({ form: errorMessage(err) });
      } finally {
        setBusy(false);
      }
    };
    if (hits.length > 0) {
      Alert.alert('Allergy warning', `The patient is allergic to ${hits.join(', ')}. Prescribe anyway?`, [
        { text: 'Go back', style: 'cancel' },
        { text: 'Prescribe anyway', style: 'destructive', onPress: () => void send() },
      ]);
      return;
    }
    await send();
  }

  return (
    <>
      <Stack.Screen options={{ title: name ? `Rx · ${name}` : 'Write prescription' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <DemoBanner visible={patient.demo} />
          {allergies.length > 0 ? (
            <View style={s.allergy}>
              <Ionicons name="warning-outline" size={16} color={colors.danger} />
              <Text style={s.allergyText}>Allergies: {allergies.join(', ')}</Text>
            </View>
          ) : null}

          {favourites.length > 0 ? (
            <>
              <SectionTitle>Favourites</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                {favourites.map((f) => (
                  <Pressable
                    key={f.drugName}
                    style={s.fav}
                    onPress={() => addFavourite(f)}
                    onLongPress={() =>
                      Alert.alert('Remove favourite?', f.drugName, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => void removeFavourite(f.drugName, favourites).then(setFavourites) },
                      ])
                    }
                  >
                    <Text style={s.favText}>{f.drugName}</Text>
                    <Text style={s.favMeta}>{[f.dose, f.frequency, f.days ? `${f.days}d` : ''].filter(Boolean).join(' · ')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <SectionTitle>Medicines</SectionTitle>
          {lines.map((l, i) => (
            <LineEditor
              key={i}
              index={i}
              line={l}
              error={errors[i]}
              allergyHit={allergyHits(l.drugName, allergies)}
              onChange={(patch) => update(i, patch)}
              onRemove={lines.length > 1 ? () => setLines((prev) => prev.filter((_, idx) => idx !== i)) : undefined}
              onFavourite={
                l.drugName.trim()
                  ? () => void saveFavourite(l, favourites).then(setFavourites)
                  : undefined
              }
            />
          ))}
          <Button title="Add medicine" variant="outline" onPress={() => setLines((prev) => [...prev, emptyLine()])} />

          <SectionTitle>Advice and follow-up</SectionTitle>
          <Card style={{ gap: space.md }}>
            <Field label="Advice" value={advice} onChangeText={setAdvice} placeholder="e.g. Plenty of fluids, rest" multiline style={[s.input, { height: 80, textAlignVertical: 'top', paddingTop: space.sm }]} />
            <Field
              label="Follow-up date (YYYY-MM-DD)"
              value={followUpDate}
              onChangeText={setFollowUpDate}
              placeholder="Optional"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
            {errors.followUpDate ? <ErrorText>{errors.followUpDate}</ErrorText> : null}
          </Card>

          {errors.form ? <ErrorText>{errors.form}</ErrorText> : null}
          <Button title="Save prescription" onPress={() => void submit()} loading={busy} disabled={patient.loading || !!patient.error} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function LineEditor({
  index,
  line: l,
  error,
  allergyHit,
  onChange,
  onRemove,
  onFavourite,
}: {
  index: number;
  line: RxDraftLine;
  error?: string;
  allergyHit: string[];
  onChange: (patch: Partial<RxDraftLine>) => void;
  onRemove?: () => void;
  onFavourite?: () => void;
}) {
  const auto = suggestQty(l.frequency, Number(l.days));
  return (
    <Card style={[{ gap: space.sm }, allergyHit.length > 0 && { borderColor: colors.danger, borderWidth: 1.5 }]}>
      <View style={s.lineHead}>
        <Text style={s.lineNo}>{index + 1}</Text>
        <TextInput
          value={l.drugName}
          onChangeText={(drugName) => onChange({ drugName })}
          placeholder="Medicine, e.g. Tab Paracetamol 650 mg"
          placeholderTextColor={colors.muted}
          style={[s.input, { flex: 1 }]}
          autoCapitalize="words"
          accessibilityLabel={`Medicine ${index + 1}`}
        />
        {onFavourite ? <IconButton icon="star-outline" label="Save as favourite" onPress={onFavourite} /> : null}
        {onRemove ? <IconButton icon="trash-outline" label="Remove medicine" onPress={onRemove} /> : null}
      </View>
      {allergyHit.length > 0 ? <ErrorText>Patient is allergic to {allergyHit.join(', ')}</ErrorText> : null}
      <View style={s.chips}>
        {FREQUENCIES.map((f) => {
          const active = l.frequency === f;
          return (
            <Pressable key={f} onPress={() => onChange({ frequency: f })} style={[s.freq, active && s.freqActive]} accessibilityState={{ selected: active }}>
              <Text style={[s.freqText, active && { color: colors.white }]}>{f}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.grid}>
        <Small label="Dose" value={l.dose} onChange={(dose) => onChange({ dose })} placeholder="1 tab" />
        <Small label="Days" value={l.days} onChange={(days) => onChange({ days: days.replace(/\D/g, '') })} keyboardType="number-pad" />
        <Small
          label="Qty"
          value={l.qty}
          onChange={(qty) => onChange({ qty: qty.replace(/[^\d.]/g, '') })}
          placeholder={auto !== null ? String(auto) : 'Qty'}
          keyboardType="decimal-pad"
        />
      </View>
      <TextInput
        value={l.instructions}
        onChangeText={(instructions) => onChange({ instructions })}
        placeholder="Instructions, e.g. after food"
        placeholderTextColor={colors.muted}
        style={s.input}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

function Small({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad' | 'decimal-pad';
}) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={s.smallLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        style={s.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  allergy: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: space.sm },
  allergyText: { color: colors.danger, fontWeight: '700', fontSize: 14, flex: 1 },
  fav: { backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 200 },
  favText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  favMeta: { color: colors.accent, fontSize: 12 },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  lineNo: { width: 22, fontWeight: '800', color: colors.muted, fontSize: 15 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  freq: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  freqActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  freqText: { fontSize: 13, fontWeight: '600', color: colors.text },
  grid: { flexDirection: 'row', gap: space.sm },
  smallLabel: { fontSize: 12, fontWeight: '600', color: colors.muted },
});
