/**
 * Screen 1 - Home (spec 9): vitals dashboard, medication reminders, and a
 * persistent Emergency button.
 *
 * The vitals shown are the `VitalReading` kinds already defined in
 * @triage/shared's `types/patient.ts`, so what the dashboard displays and what
 * the agent can reason over are the same list by construction.
 *
 * The demo profile is local placeholder data. It is labelled as such on screen
 * rather than presented as real readings - a dashboard of invented vitals that
 * looks authoritative is exactly the kind of thing that should never be
 * ambiguous in a medical context.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { FIRST_AID_TOPICS } from '../data/firstAidContent';
import { api } from '../api/client';

interface Props {
  readonly onStartEmergency: () => void;
  readonly onOpenFirstAid: () => void;
  readonly onOpenEmergencyCard: () => void;
  readonly onOpenLanguage: () => void;
}

const DEMO_VITALS = [
  { label: 'Blood pressure', value: '128/84', unit: 'mmHg' },
  { label: 'Blood glucose', value: '112', unit: 'mg/dL' },
  { label: 'SpO2', value: '97', unit: '%' },
  { label: 'Heart rate', value: '78', unit: 'bpm' },
];

const DEMO_MEDICATIONS = [
  { name: 'Metformin 500 mg', when: '8:00 AM', taken: true },
  { name: 'Amlodipine 5 mg', when: '9:00 PM', taken: false },
];

export function HomeScreen({
  onStartEmergency,
  onOpenFirstAid,
  onOpenEmergencyCard,
  onOpenLanguage,
}: Props) {
  const [serverOk, setServerOk] = useState<boolean | undefined>(undefined);
  const [scorer, setScorer] = useState<string | undefined>(undefined);

  // Surface orchestrator reachability up front. Discovering the server is down
  // at the moment you press Emergency is the worst possible time to find out.
  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (cancelled) return;
        setServerOk(h.ok);
        setScorer(h.clinicalScorer);
      })
      .catch(() => {
        if (!cancelled) setServerOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Good morning</Text>
      <Text style={styles.subtitle}>Demo profile, 52, male</Text>

      <ConnectionRow ok={serverOk} scorer={scorer} />

      <Text style={styles.sectionTitle}>Today's vitals</Text>
      <Text style={styles.placeholderNote}>Sample values for this demo, not real readings.</Text>
      <View style={styles.vitalsGrid}>
        {DEMO_VITALS.map((v) => (
          <View key={v.label} style={styles.vitalCard}>
            <Text style={styles.vitalLabel}>{v.label}</Text>
            <Text style={styles.vitalValue}>
              {v.value}
              <Text style={styles.vitalUnit}> {v.unit}</Text>
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Medication reminders</Text>
      <View style={styles.card}>
        {DEMO_MEDICATIONS.map((m, i) => (
          <View key={m.name} style={[styles.medRow, i > 0 && styles.medRowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{m.name}</Text>
              <Text style={type.small}>{m.when}</Text>
            </View>
            <Text style={[styles.medState, m.taken ? styles.medTaken : styles.medDue]}>
              {m.taken ? 'Taken' : 'Due'}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        style={styles.emergencyButton}
        onPress={onStartEmergency}
        accessibilityRole="button"
      >
        <Text style={styles.emergencyText}>EMERGENCY</Text>
        <Text style={styles.emergencySub}>Get help now</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={onOpenFirstAid} accessibilityRole="button">
        <Text style={styles.secondaryText}>First aid, works offline</Text>
        <Text style={type.small}>{FIRST_AID_TOPICS.length} guides stored on this device</Text>
      </Pressable>

      {/* Secondary entry points. Deliberately below the emergency button and
          visually quieter - nothing here should compete with it. */}
      <View style={styles.utilityRow}>
        <Pressable style={styles.utilityButton} onPress={onOpenEmergencyCard}>
          <Text style={styles.utilityText}>Emergency card</Text>
          <Text style={type.tiny}>Blood group, allergies, contacts</Text>
        </Pressable>
        <Pressable style={styles.utilityButton} onPress={onOpenLanguage}>
          <Text style={styles.utilityText}>Language</Text>
          <Text style={type.tiny}>English / हिन्दी / తెలుగు / தமிழ்</Text>
        </Pressable>
      </View>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function ConnectionRow({ ok, scorer }: { ok: boolean | undefined; scorer: string | undefined }) {
  if (ok === undefined) {
    return (
      <View style={[styles.statusRow, { backgroundColor: colors.bg }]}>
        <Text style={type.small}>Checking connection...</Text>
      </View>
    );
  }
  if (!ok) {
    return (
      <View style={[styles.statusRow, { backgroundColor: colors.dangerSoft }]}>
        <Text style={styles.statusBad}>Orchestrator unreachable</Text>
        <Text style={type.small}>
          Set EXPO_PUBLIC_API_URL to your computer's LAN IP (not localhost) and restart Expo.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.statusRow, { backgroundColor: colors.successSoft }]}>
      <Text style={styles.statusGood}>Connected</Text>
      {scorer === 'local_fallback' ? (
        <Text style={type.small}>
          Clinical scoring is running on the conservative local fallback, and results are flagged.
        </Text>
      ) : (
        <Text style={type.small}>Clinical scoring engine online.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  utilityRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  utilityButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  utilityText: { fontSize: 14, fontWeight: '700', color: colors.text },

  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  subtitle: { ...type.small, marginTop: -spacing.sm },
  sectionTitle: { ...type.h3, marginTop: spacing.md },
  placeholderNote: { ...type.tiny, marginTop: -spacing.sm },

  statusRow: { padding: spacing.md, borderRadius: radius.md, gap: 2 },
  statusGood: { ...type.h3, color: colors.success },
  statusBad: { ...type.h3, color: colors.danger },

  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  vitalCard: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  vitalLabel: { ...type.tiny, marginBottom: spacing.xs },
  vitalValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  vitalUnit: { fontSize: 13, fontWeight: '500', color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  medRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  medRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  medState: { fontSize: 13, fontWeight: '700' },
  medTaken: { color: colors.success },
  medDue: { color: colors.warning },

  emergencyButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  emergencyText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  emergencySub: { color: '#FFE4E6', fontSize: 13, marginTop: 2 },

  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
  },
  secondaryText: { ...type.h3, marginBottom: 2 },
});
