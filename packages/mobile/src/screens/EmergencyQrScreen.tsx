/**
 * Emergency QR Card (5.6).
 *
 * A responder scans this with any phone camera and gets blood group,
 * allergies, medications and a contact number - without unlocking the phone,
 * installing anything, or having an account.
 *
 * THE ENCODING DECISION: the QR carries the DATA ITSELF, not a link to it.
 * A URL would be smaller and prettier, but it fails in exactly the situation
 * this exists for - a basement, an ambulance in a dead spot, a responder whose
 * phone has no signal. Self-contained means it works offline on both sides.
 *
 * The consequence, accepted deliberately: anyone who can see the screen can
 * read the medical data. That is the same trade the printed cards in people's
 * wallets already make, and it is the right one here - a card that only works
 * with a network is not an emergency card.
 *
 * KNOWN LIMIT, stated on the screen rather than buried: this cannot be reached
 * from the OS lock screen in Expo Go. True lock-screen access needs a native
 * widget or Medical ID integration, which requires a development build. What
 * IS available today is keeping the screen awake and at full brightness so the
 * card can be handed over unlocked.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DEMO_CONTACTS, DEMO_DEMOGRAPHICS, DEMO_EMERGENCY_CARD } from '../data/demoProfile';
import { colors, radius, spacing, type } from '../theme';

/**
 * Kept compact on purpose. QR density rises fast with payload length, and a
 * dense code is slower to scan in bad light - which is the only light this
 * will ever be scanned in. Short keys, no JSON envelope.
 */
function buildPayload(): string {
  const c = DEMO_EMERGENCY_CARD;
  const primary = DEMO_CONTACTS.find((x) => x.isPrimary) ?? DEMO_CONTACTS[0];
  const lines = [
    `MEDICAL ID: ${DEMO_DEMOGRAPHICS.displayName ?? 'Unknown'}`,
    `AGE/SEX: ${DEMO_DEMOGRAPHICS.ageYears}/${DEMO_DEMOGRAPHICS.sex}`,
    `BLOOD: ${c.bloodGroup ?? 'unknown'}`,
    `ALLERGIES: ${c.allergies.length > 0 ? c.allergies.join('; ') : 'none reported'}`,
    `MEDS: ${c.medications.map((m) => m.normalizedName ?? m.reportedName).join('; ') || 'none'}`,
    `CONDITIONS: ${c.chronicConditions.join('; ') || 'none'}`,
    primary === undefined ? '' : `ICE: ${primary.name} ${primary.phone}`,
    c.notes === undefined ? '' : `NOTE: ${c.notes}`,
  ];
  return lines.filter((l) => l.length > 0).join('\n');
}

export function EmergencyQrScreen({ onBack }: { readonly onBack: () => void }) {
  const [Qr, setQr] = useState<React.ComponentType<Record<string, unknown>> | undefined>(undefined);
  const payload = buildPayload();

  useEffect(() => {
    // Handing an unlocked phone to a responder is useless if it sleeps in
    // their hand mid-scan.
    void activateKeepAwakeAsync('emergency-qr');
    return () => deactivateKeepAwake('emergency-qr');
  }, []);

  useEffect(() => {
    // Required lazily for the same reason as react-native-maps: a native
    // rendering dependency must not be able to take the whole screen down.
    // Without a QR the text below is still fully readable and usable.
    try {
      const mod = require('react-native-qrcode-svg') as { default: React.ComponentType<Record<string, unknown>> };
      setQr(() => mod.default);
    } catch {
      setQr(undefined);
    }
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Emergency card</Text>
      <Text style={type.small}>Show this to a paramedic. Works with no signal.</Text>

      <View style={styles.qrPanel}>
        {Qr === undefined ? (
          <Text style={styles.qrFallback}>
            QR unavailable on this device. The details below are complete on their own.
          </Text>
        ) : (
          <Qr value={payload} size={230} backgroundColor="#FFFFFF" color="#000000" />
        )}
      </View>

      {/* Always rendered, never only inside the QR: a responder with a cracked
          camera, or no phone at all, still needs to read this. */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>WHAT THE CODE CONTAINS</Text>
        <Text style={styles.payload}>{payload}</Text>
      </View>

      <View style={styles.noteCard}>
        <Text style={type.h3}>Reaching this from the lock screen</Text>
        <Text style={type.small}>
          Add these details to your phone's own Medical ID (iOS Health, or Android emergency
          information) so responders can reach them without unlocking. This app cannot place a
          widget on the lock screen while it runs through Expo Go.
        </Text>
      </View>

      <Text style={styles.privacy}>
        Anyone who can see this screen can read these details. That is deliberate - the card has to
        work when there is no network and nobody can log in.
      </Text>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  qrPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 270,
  },
  qrFallback: { ...type.small, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.sm },
  payload: { ...type.body, lineHeight: 21, fontFamily: 'monospace', fontSize: 12.5 },
  noteCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  privacy: { ...type.tiny, lineHeight: 16 },
  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
