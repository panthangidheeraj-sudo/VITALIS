/**
 * Manually-entered vitals panel — redesigned to match reference UI.
 *
 * Shows heading + "Log a reading" action, supporting text, and
 * either an "+ Add a reading" pill button (empty state) or the readings grid.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useVitals, type VitalsReading } from '../data/vitalsStore';
import { Glass, Label, PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

// Design tokens
const D = {
  text: '#142744',
  muted: '#7185A3',
  primary: '#1769E8',
} as const;

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
      {/* Header row */}
      <View style={styles.sectionHead}>
        <Text style={styles.heading}>Your vitals</Text>
        {!editing ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <View style={styles.logReadingBtn}>
              <Text style={styles.logReadingText}>{hasAnyReading ? 'Edit' : 'Log a reading'}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Supporting text */}
      <Text style={styles.supportingText}>
        {'Enter by you from your own BP cuff, glucometer or oximeter\n— nothing here is read from a connected device.'}
      </Text>

      {/* Content */}
      {editing ? (
        <Glass tone="blue" contentStyle={styles.editCard}>
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
        </Glass>
      ) : !hasAnyReading ? (
        // "+ Add a reading" pill button — matches reference design
        <Pressable onPress={() => setEditing(true)} hitSlop={6}>
          {({ pressed }) => (
            <View style={[styles.addReadingPill, pressed && { opacity: 0.8 }]}>
              <BlurView intensity={18} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
              <View style={styles.addReadingTint} />
              <View style={styles.addPlusCircle}>
                <Text style={styles.addPlusText}>+</Text>
              </View>
              <Text style={styles.addReadingLabel}>Add a reading</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <>
          <View style={styles.grid}>
            {vitals.bpSys !== undefined ? (
              <Tile label="BLOOD PRESSURE" value={`${vitals.bpSys}${vitals.bpDia === undefined ? '' : `/${vitals.bpDia}`}`} unit="mmHg" />
            ) : null}
            {vitals.heartRate !== undefined ? <Tile label="HEART RATE" value={String(vitals.heartRate)} unit="bpm" /> : null}
            {vitals.spo2 !== undefined ? <Tile label="SPO₂" value={String(vitals.spo2)} unit="%" /> : null}
            {vitals.glucose !== undefined ? <Tile label="BLOOD GLUCOSE" value={String(vitals.glucose)} unit="mg/dL" /> : null}
          </View>
          <Pressable onPress={() => setEditing(true)} hitSlop={6} style={{ marginTop: 10 }}>
            {({ pressed }) => (
              <View style={[styles.addReadingPill, pressed && { opacity: 0.8 }]}>
                <BlurView intensity={18} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                <View style={styles.addReadingTint} />
                <View style={styles.addPlusCircle}>
                  <Text style={styles.addPlusText}>+</Text>
                </View>
                <Text style={styles.addReadingLabel}>Add a reading</Text>
              </View>
            )}
          </Pressable>
        </>
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
    <Glass tone="blue" style={styles.tileFlex} contentStyle={styles.tile}>
      <Label style={{ marginBottom: 8 }}>{label}</Label>
      <Text style={type.metric}>
        {value}
        <Text style={styles.unit}>{` ${unit}`}</Text>
      </Text>
    </Glass>
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
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  heading: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    color: '#142744',
    letterSpacing: -0.3,
  },
  logReadingBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(23,105,232,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(23,105,232,0.20)',
  },
  logReadingText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: '#1769E8',
  },
  supportingText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: '#7185A3',
    lineHeight: 16,
    marginBottom: 14,
  },

  // Add reading pill
  addReadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.80)',
    gap: 8,
  },
  addReadingTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23,105,232,0.14)',
  },
  addPlusCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1769E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlusText: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    color: 'white',
    lineHeight: 20,
    marginTop: -1,
  },
  addReadingLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: '#1769E8',
  },

  // Grid of readings
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tileFlex: { width: '48%', flexGrow: 1 },
  tile: { padding: 14 },
  unit: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate },

  // Edit form
  editCard: { padding: spacing.xl, gap: spacing.md },
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
  loggedAt: { ...type.foot, marginTop: 10 },
});
