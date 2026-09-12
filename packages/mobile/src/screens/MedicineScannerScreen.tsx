/**
 * Medicine Scanner (5.6).
 *
 * Read a medicine's name off the pack and get back what it actually is
 * (RxNorm-normalised) and whether it has expired.
 *
 * THE ONE THING IT REFUSES TO DO, and says so on screen: check interactions.
 *
 *   The feature was specified as "expiry, dosage, interaction info". The first
 *   two are real. The third is not available to us - RxNav retired its
 *   interaction endpoints in January 2024 and no free source replaces them.
 *   An empty interactions section would be read as "no interactions found",
 *   which is the most dangerous possible misreading. So the section exists, it
 *   states that interactions are NOT checked, and it points at a pharmacist.
 *
 * Expiry is arithmetic done on the device against the date the user confirms
 * reading - not inferred by a model. A wrong expiry date is a safety claim,
 * and a model guessing at smudged packaging is not a basis for one.
 *
 * The camera path needs a vision model the Groq account does not currently
 * have, so scanning falls back to typing. Stated on screen, not hidden.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError, type MedicationLookup } from '../api/client';
import { colors, radius, spacing, type } from '../theme';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'looking_up' }
  | { readonly kind: 'done'; readonly result: MedicationLookup }
  | { readonly kind: 'error'; readonly message: string };

/** Whole months until an expiry of the form YYYY-MM. Negative once expired. */
function monthsUntil(expiry: string): number | undefined {
  const parsed = /^(\d{4})-(\d{1,2})$/.exec(expiry.trim());
  if (parsed === null) return undefined;
  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  if (month < 1 || month > 12) return undefined;
  const now = new Date();
  return (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
}

export function MedicineScannerScreen({ onBack }: { readonly onBack: () => void }) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const lookup = useCallback(async () => {
    if (name.trim().length === 0) return;
    setStatus({ kind: 'looking_up' });
    try {
      const result = await api.normalizeMedications([name.trim()]);
      setStatus({ kind: 'done', result });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Lookup failed.',
      });
    }
  }, [name]);

  const months = expiry.length > 0 ? monthsUntil(expiry) : undefined;
  const med = status.kind === 'done' ? status.result.medications[0] : undefined;
  const disabled = name.trim().length === 0 || status.kind === 'looking_up';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Medicine scanner</Text>
      <Text style={type.small}>Check what a medicine is and whether it is still in date.</Text>

      <View style={styles.scanFrame}>
        <Text style={styles.scanHint}>Camera scanning is unavailable</Text>
        <Text style={type.tiny}>No vision model is configured. Type the name instead.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>NAME ON THE PACK</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Glucophage, or metformin"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
        />
        <Text style={[styles.cardLabel, styles.spaced]}>EXPIRY ON THE PACK</Text>
        <TextInput
          style={styles.input}
          value={expiry}
          onChangeText={setExpiry}
          placeholder="YYYY-MM, e.g. 2027-04"
          placeholderTextColor={colors.textFaint}
        />
      </View>

      <Pressable
        style={[styles.primaryButton, disabled && styles.disabled]}
        onPress={() => void lookup()}
        disabled={disabled}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>
          {status.kind === 'looking_up' ? 'Checking...' : 'Check this medicine'}
        </Text>
      </Pressable>

      {status.kind === 'looking_up' ? <ActivityIndicator color={colors.primary} /> : null}

      {/* Expiry is arithmetic on what the user read, never a model's guess. */}
      {months !== undefined ? (
        <View
          style={[
            styles.card,
            months < 0 ? styles.expired : months <= 2 ? styles.soon : styles.plain,
          ]}
        >
          <Text style={styles.cardLabel}>EXPIRY</Text>
          <Text style={styles.verdict}>{expiryVerdict(months)}</Text>
          {months < 0 ? <Text style={type.small}>Do not take this. Replace it.</Text> : null}
        </View>
      ) : null}

      {med !== undefined ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>WHAT THIS IS</Text>
          <Text style={type.h3}>{med.normalizedName ?? med.reportedName}</Text>
          {med.normalizedName !== undefined && med.normalizedName !== med.reportedName ? (
            <Text style={type.small}>You typed: {med.reportedName}</Text>
          ) : null}
          <Text style={type.tiny}>
            {med.rxcui !== undefined
              ? 'Verified against RxNorm, the US national drug vocabulary.'
              : 'Not found in RxNorm - it may be a local brand name. Kept exactly as you typed it.'}
          </Text>
        </View>
      ) : null}

      {/* Shown on every completed lookup, not only on failure: a warning that
          appears sometimes is a warning people learn to ignore. */}
      {status.kind === 'done' ? (
        <View style={styles.warnCard}>
          <Text style={styles.warnTitle}>INTERACTIONS ARE NOT CHECKED</Text>
          <Text style={type.small}>{status.result.interactionNotice}</Text>
        </View>
      ) : null}

      {status.kind === 'error' ? <Text style={styles.error}>{status.message}</Text> : null}

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={styles.tail} />
    </ScrollView>
  );
}

function expiryVerdict(months: number): string {
  if (months < 0) {
    const n = Math.abs(months);
    return 'EXPIRED ' + n + (n === 1 ? ' month ago' : ' months ago');
  }
  if (months === 0) return 'EXPIRES THIS MONTH';
  return 'In date - ' + months + (months === 1 ? ' month left' : ' months left');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  tail: { height: spacing.xxl },
  spaced: { marginTop: spacing.md },

  scanFrame: {
    height: 150,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scanHint: { ...type.h3 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  plain: {},
  cardLabel: { ...type.tiny, letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },

  expired: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  soon: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  verdict: { fontSize: 18, fontWeight: '800', color: colors.text },

  warnCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  warnTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.text },

  error: { ...type.small, color: colors.danger },
  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
