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
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, type MedicationLookup } from '../api/client';
import { colors, fonts, glass, radius, spacing, type } from '../theme';
import { BackLink, Card, Label, NoticeCard, PrimaryButton } from '../ui/primitives';

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
    <View style={styles.root}>
      <BackLink onPress={onBack} />

      <Text style={type.h1}>Medicine scanner</Text>
      <Text style={[type.small, { marginTop: -6 }]}>
        Check what a medicine is and whether it is still in date.
      </Text>

      <View style={styles.scanFrame}>
        <Label color="#5b6b83" style={{ letterSpacing: 0.6 }}>
          CAMERA SCANNING UNAVAILABLE
        </Label>
        <Text style={styles.scanHint}>No camera module is installed. Type the name instead.</Text>
      </View>

      <Card tone="blue">
        <Label>NAME ON THE PACK</Label>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Glucophage, or metformin"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
        />
        <Label style={{ marginTop: 16 }}>EXPIRY ON THE PACK</Label>
        <TextInput
          style={styles.input}
          value={expiry}
          onChangeText={setExpiry}
          placeholder="YYYY-MM, e.g. 2027-04"
          placeholderTextColor={colors.faint}
        />
      </Card>

      <PrimaryButton
        label={status.kind === 'looking_up' ? 'Checking…' : 'Check this medicine'}
        onPress={disabled ? undefined : () => void lookup()}
        busy={status.kind === 'looking_up'}
      />

      {/* Expiry is arithmetic on what the USER read off the pack, never a
          model's guess. That is why it is allowed to be this definite. */}
      {months !== undefined ? (
        <NoticeCard
          accent={months < 0 ? colors.danger : months <= 2 ? colors.warn : colors.ok}
          background={
            months < 0 ? colors.dangerWash : months <= 2 ? colors.warnWash : 'rgba(21,128,61,0.1)'
          }
          border={
            months < 0
              ? 'rgba(220,38,38,0.3)'
              : months <= 2
                ? 'rgba(217,119,6,0.35)'
                : 'rgba(21,128,61,0.3)'
          }
        >
          <Label color={months < 0 ? colors.dangerDeep : months <= 2 ? colors.warnDeep : colors.ok}>
            EXPIRY
          </Label>
          <Text style={styles.verdict}>{expiryVerdict(months)}</Text>
          {months < 0 ? (
            <Text style={[type.small, { color: colors.dangerInk, marginTop: 4 }]}>
              Do not take this. Replace it.
            </Text>
          ) : null}
        </NoticeCard>
      ) : null}

      {med !== undefined ? (
        <Card tone="blue">
          <Label>WHAT THIS IS</Label>
          <Text style={[type.h3, { fontSize: 16, marginTop: 9 }]}>
            {med.normalizedName ?? med.reportedName}
          </Text>
          {med.normalizedName !== undefined && med.normalizedName !== med.reportedName ? (
            <Text style={[type.small, { marginTop: 3 }]}>{`You typed: ${med.reportedName}`}</Text>
          ) : null}
          <Text style={[type.foot, { marginTop: 7 }]}>
            {med.rxcui !== undefined
              ? 'Verified against RxNorm, the US national drug vocabulary.'
              : 'Not found in RxNorm — it may be a local brand name. Kept exactly as you typed it.'}
          </Text>
        </Card>
      ) : null}

      {/* Shown on EVERY completed lookup, not only on failure: a warning that
          appears sometimes is a warning people learn to ignore. */}
      {status.kind === 'done' ? (
        <NoticeCard accent={colors.warn} background={colors.warnWash} border="rgba(217,119,6,0.35)">
          <Label color={colors.warnDeep}>INTERACTIONS ARE NOT CHECKED</Label>
          <Text style={[type.small, { color: colors.warnInk, marginTop: 6 }]}>
            {status.result.interactionNotice}
          </Text>
        </NoticeCard>
      ) : null}

      {status.kind === 'error' ? (
        <NoticeCard accent={colors.danger} background={colors.dangerWash} border="rgba(220,38,38,0.3)">
          <Text style={[type.small, { color: colors.dangerInk }]}>{status.message}</Text>
        </NoticeCard>
      ) : null}
    </View>
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
  root: { gap: spacing.lg },
  scanFrame: {
    height: 150,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(29,78,216,0.35)',
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanHint: { fontFamily: fonts.sans, fontSize: 11, color: colors.label },
  input: {
    ...glass('plain'),
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 9,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink,
  },
  verdict: { fontFamily: fonts.sansBlack, fontSize: 17, color: colors.ink, marginTop: 8 },
});
