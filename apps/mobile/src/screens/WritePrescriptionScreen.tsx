import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AllergyConflictError } from '@/data/client';
import { FREQUENCIES, allergyHits, buildPrescription, draftFromLines, emptyLine, suggestQty, type RxDraftLine } from '@/data/rx';
import type { EncounterRx, RxFavourite } from '@/data/types';
import { data } from '@/lib/data';
import { addFavourite, loadFavourites, removeFavourite, type FavouriteStore } from '@/lib/favourites';
import { errorMessage, useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorText, Field, colors, radius, space } from '@/ui';
import { DemoBanner, IconButton, SectionTitle } from '@/ui/widgets';

/**
 * E-prescription (doctor app lite): medicines with Indian dosing shorthand, auto quantity, favourites,
 * allergy check with override reason. With an open consultation it edits that consultation's prescription.
 */
export function WritePrescriptionScreen({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const patient = useLoad(() => data.patient(patientId), patientId);
  const allergies = patient.data?.allergies ?? [];
  const name = patient.data ? [patient.data.firstName, patient.data.lastName].filter(Boolean).join(' ') : '';

  const [lines, setLines] = useState<RxDraftLine[]>([emptyLine()]);
  const [advice, setAdvice] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'sign' | null>(null);
  const [favs, setFavs] = useState<FavouriteStore>({ items: [], local: true });
  const [existing, setExisting] = useState<EncounterRx | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(!!encounterId);

  useEffect(() => {
    void loadFavourites().then(setFavs);
  }, []);

  useEffect(() => {
    if (!encounterId) return;
    data
      .encounterRx(encounterId)
      .then((enc) => {
        setExisting(enc);
        if (enc && enc.lines.length) setLines(draftFromLines(enc.lines));
        if (enc?.advice) setAdvice(enc.advice);
        if (enc?.followUpDate) setFollowUpDate(enc.followUpDate);
      })
      .catch((err: unknown) => setErrors({ form: errorMessage(err) }))
      .finally(() => setLoadingExisting(false));
  }, [encounterId]);

  const locked = !!existing?.signed;
  const update = (i: number, patch: Partial<RxDraftLine>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function applyFavourite(f: RxFavourite) {
    setLines((prev) => {
      const kept = prev.filter((l) => l.drugName.trim());
      return [...kept, ...draftFromLines(f.lines)];
    });
  }

  async function submit(sign: boolean) {
    const result = buildPrescription({ patientId, encounterId: existing?.encounterId ?? encounterId, lines, advice, followUpDate, allergies, sign });
    setErrors(result.errors);
    if (!result.ok || !result.body) return;
    const body = result.body;
    const send = async () => {
      setBusy(sign ? 'sign' : 'save');
      try {
        const saved = await data.createPrescription(body);
        Alert.alert(
          sign ? 'Prescription signed' : 'Prescription saved',
          [saved.rxNo, `${body.lines.length} medicine${body.lines.length === 1 ? '' : 's'} for ${name || 'the patient'}`].filter(Boolean).join(' · '),
        );
        router.back();
      } catch (err) {
        if (err instanceof AllergyConflictError) {
          const next: Record<string, string> = { form: err.message };
          // conflicts[].line indexes the submitted lines; map back to the form rows by drug name.
          for (const c of err.conflicts) {
            const row = lines.findIndex((l) => l.drugName.trim().toLowerCase() === c.drugName.toLowerCase());
            if (row >= 0) next[row] = `Allergy (${c.allergy}): give a reason to prescribe anyway`;
          }
          setErrors(next);
        } else {
          setErrors({ form: errorMessage(err) });
        }
      } finally {
        setBusy(null);
      }
    };
    if (sign) {
      Alert.alert('Sign and lock?', 'A signed consultation cannot be edited. Corrections go in as addenda.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign', onPress: () => void send() },
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
          {loadingExisting ? <ActivityIndicator color={colors.primary} /> : null}
          {allergies.length > 0 ? (
            <View style={s.allergy}>
              <Ionicons name="warning-outline" size={16} color={colors.danger} />
              <Text style={s.allergyText}>Allergies: {allergies.join(', ')}</Text>
            </View>
          ) : null}
          {existing && existing.lines.length > 0 && !locked ? (
            <Text style={s.note}>Editing this consultation's prescription. Saving replaces it.</Text>
          ) : null}
          {locked ? (
            <Card>
              <Text style={s.lockTitle}>This consultation is signed</Text>
              <Text style={s.note}>Its prescription can no longer be changed. Add corrections as an addendum from the web app.</Text>
            </Card>
          ) : null}

          {!locked && favs.items.length > 0 ? (
            <>
              <SectionTitle right={favs.local ? <Text style={s.note}>On this phone</Text> : undefined}>Favourites</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                {favs.items.map((f) => (
                  <Pressable
                    key={f.id}
                    style={s.fav}
                    onPress={() => applyFavourite(f)}
                    onLongPress={() =>
                      Alert.alert('Remove favourite?', f.name, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => void removeFavourite(favs, f.id).then(setFavs).catch((e: unknown) => setErrors({ form: errorMessage(e) })),
                        },
                      ])
                    }
                  >
                    <Text style={s.favText} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={s.favMeta} numberOfLines={1}>
                      {f.lines.length === 1 ? [f.lines[0]?.dose, f.lines[0]?.frequency, f.lines[0]?.days ? `${f.lines[0].days}d` : ''].filter(Boolean).join(' · ') : `${f.lines.length} medicines`}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {!locked ? (
            <>
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
                      ? () => {
                          const qty = Number(l.qty) || suggestQty(l.frequency, Number(l.days)) || 0;
                          void addFavourite(favs, { drugName: l.drugName.trim(), dose: l.dose.trim() || '1 unit', frequency: l.frequency, days: Number(l.days) || 0, qty })
                            .then(setFavs)
                            .catch((e: unknown) => setErrors({ form: errorMessage(e) }));
                        }
                      : undefined
                  }
                />
              ))}
              <Button title="Add medicine" variant="outline" onPress={() => setLines((prev) => [...prev, emptyLine()])} />

              <SectionTitle>Advice and follow-up</SectionTitle>
              <Card style={{ gap: space.md }}>
                <Field
                  label="Advice"
                  value={advice}
                  onChangeText={setAdvice}
                  placeholder="e.g. Plenty of fluids, rest"
                  multiline
                  style={[s.input, { height: 80, textAlignVertical: 'top', paddingTop: space.sm }]}
                />
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
              <Button title="Save prescription" onPress={() => void submit(false)} loading={busy === 'save'} disabled={busy !== null || patient.loading || !!patient.error || loadingExisting} />
              <Button title="Save and sign" variant="outline" onPress={() => void submit(true)} loading={busy === 'sign'} disabled={busy !== null || patient.loading || !!patient.error || loadingExisting} />
            </>
          ) : null}
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
      {allergyHit.length > 0 || error?.startsWith('Allergy') ? (
        <>
          {allergyHit.length > 0 ? <ErrorText>Patient is allergic to {allergyHit.join(', ')}</ErrorText> : null}
          <TextInput
            value={l.overrideReason}
            onChangeText={(overrideReason) => onChange({ overrideReason })}
            placeholder="Reason to prescribe anyway (required)"
            placeholderTextColor={colors.muted}
            style={[s.input, { borderColor: colors.danger }]}
            accessibilityLabel="Allergy override reason"
          />
        </>
      ) : null}
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
  note: { fontSize: 13, color: colors.muted },
  lockTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
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
