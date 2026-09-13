/**
 * Manually-entered vitals — see `data/vitalsStore.ts` for why this replaced
 * the animated bar chart / ECG trace / filling ring that used to sit here.
 *
 * Two states only: nothing logged yet (an honest empty state, not a fabricated
 * number), and a logged reading shown with WHEN it was entered. Editing is a
 * single form for all four values rather than four separate inline editors —
 * someone transcribing numbers off a home BP cuff and a glucometer is doing
 * it once, in one sitting, not field by field.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useVitals, type VitalsReading } from '../data/vitalsStore';
import { Label, PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, fonts, glass, radius, spacing, type } from '../theme';

export function VitalsPanel() {
  const { vitals, loading, save } = useVitals();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editing) return;
    setDraft({
      bpSys: vitals.bpSys?.toString() ?? '',
      bpDia: vitals.bpDia?.toString() ?? '',
      heartRate: vitals.heartRate?.toString() ?? '',
      spo2: vitals.spo2?.toString() ?? '',
      glucose: vitals.glucose?.toString() ?? '',
    });
  }, [editing, vitals]);

  const hasAnyReading =
    vitals.bpSys !== undefined ||
    vitals.heartRate !== undefined ||
    vitals.spo2 !== undefined ||
    vitals.glucose !== undefined;

  const submit = () => {
    const num = (key: string): number | undefined => {
      const raw = draft[key]?.trim();
      if (raw === undefined || raw.length === 0) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const next: VitalsReading = {
      bpSys: num('bpSys'),
      bpDia: num('bpDia'),
      heartRate: num('heartRate'),
      spo2: num('spo2'),
      glucose: num('glucose'),
    };
    save(next);
    setEditing(false);
  };

  if (loading) return null;

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={type.h3}>Your vitals</Text>
        {!editing ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text style={styles.editLink}>{hasAnyReading ? 'Edit' : 'Log a reading'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[type.foot, { marginTop: -6, marginBottom: 9 }]}>
        Entered by you from your own BP cuff, glucometer or oximeter — nothing here is read from a
        connected device.
      </Text>

      {editing ? (
        <View style={[glass('blue'), styles.editCard]}>
          <View style={styles.row}>
            <Field label="BP SYSTOLIC" value={draft.bpSys} onChange={(v) => setDraft((d) => ({ ...d, bpSys: v }))} />
            <Field label="BP DIASTOLIC" value={draft.bpDia} onChange={(v) => setDraft((d) => ({ ...d, bpDia: v }))} />
          </View>
          <View style={styles.row}>
            <Field label="HEART RATE (BPM)" value={draft.heartRate} onChange={(v) => setDraft((d) => ({ ...d, heartRate: v }))} />
            <Field label="SPO₂ (%)" value={draft.spo2} onChange={(v) => setDraft((d) => ({ ...d, spo2: v }))} />
          </View>
          <Field label="BLOOD GLUCOSE (MG/DL)" value={draft.glucose} onChange={(v) => setDraft((d) => ({ ...d, glucose: v }))} full />
          <View style={styles.editActions}>
            <SecondaryButton label="Cancel" onPress={() => setEditing(false)} style={{ flex: 1 }} />
            <PrimaryButton label="Save" onPress={submit} style={{ flex: 1 }} />
          </View>
        </View>
      ) : !hasAnyReading ? (
        <View style={[glass('blue'), styles.emptyCard]}>
          <Text style={type.body}>No readings logged yet.</Text>
          <Text style={[type.foot, { marginTop: 4 }]}>
            Tap "Log a reading" to enter a blood pressure, pulse, SpO₂ or glucose value by hand.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {vitals.bpSys !== undefined ? (
            <Tile label="BLOOD PRESSURE" value={`${vitals.bpSys}${vitals.bpDia === undefined ? '' : `/${vitals.bpDia}`}`} unit="mmHg" />
          ) : null}
          {vitals.heartRate !== undefined ? <Tile label="HEART RATE" value={String(vitals.heartRate)} unit="bpm" /> : null}
          {vitals.spo2 !== undefined ? <Tile label="SPO₂" value={String(vitals.spo2)} unit="%" /> : null}
          {vitals.glucose !== undefined ? <Tile label="BLOOD GLUCOSE" value={String(vitals.glucose)} unit="mg/dL" /> : null}
        </View>
      )}

      {hasAnyReading && !editing && vitals.loggedAt !== undefined ? (
        <Text style={styles.loggedAt}>{`Logged ${formatWhen(vitals.loggedAt)}`}</Text>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  full = false,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (v: string) => void;
  readonly full?: boolean;
}) {
  return (
    <View style={full ? styles.fieldFull : styles.field}>
      <Label>{label}</Label>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
    </View>
  );
}

function Tile({ label, value, unit }: { readonly label: string; readonly value: string; readonly unit: string }) {
  return (
    <View style={[glass('blue'), styles.tile]}>
      <Label style={{ marginBottom: 8 }}>{label}</Label>
      <Text style={type.metric}>
        {value}
        <Text style={styles.unit}>{` ${unit}`}</Text>
      </Text>
    </View>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'recently';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `today, ${time}` : `${date.toLocaleDateString()}, ${time}`;
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  editLink: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.brand },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '48%', flexGrow: 1, padding: 14, borderRadius: radius.lg },
  unit: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate },
  emptyCard: { padding: spacing.xl, borderRadius: radius.lg },
  editCard: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  field: { flex: 1 },
  fieldFull: { flex: 1 },
  input: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.15)',
    paddingVertical: 8,
    marginTop: 4,
  },
  editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  loggedAt: { ...type.foot, marginTop: 8 },
});
