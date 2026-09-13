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
import { StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DEMO_CONTACTS, DEMO_DEMOGRAPHICS, DEMO_EMERGENCY_CARD } from '../data/demoProfile';
import { colors, fonts, glass, radius, shadow, spacing, type } from '../theme';
import { BackLink, Label, NoticeCard } from '../ui/primitives';

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
    // Wrapped in a block, not returned directly: `deactivateKeepAwake` is
    // async, and returning its promise makes React treat the promise itself as
    // the cleanup function - so the screen would never release the wake lock
    // and the phone would stay lit until it was force-quit.
    return () => {
      void deactivateKeepAwake('emergency-qr');
    };
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
    <View style={styles.root}>
      <BackLink onPress={onBack} />

      <Text style={type.h1}>Emergency QR</Text>
      <Text style={[type.small, { marginTop: -6 }]}>
        Show this to a paramedic. Works with no signal and no unlock.
      </Text>

      {/* White, not glass. A QR code needs maximum contrast and a quiet zone;
          a translucent tinted panel is the one place in this design where the
          house style would actively stop the thing from working. */}
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
      <View style={[glass('blue'), styles.card]}>
        <Label>WHAT THE CODE CONTAINS</Label>
        <Text style={styles.payload}>{payload}</Text>
      </View>

      <View style={[glass('plain'), styles.card]}>
        <Text style={type.h3}>Reaching this from the lock screen</Text>
        <Text style={[type.small, { marginTop: 8 }]}>
          {`Add these details to your phone's own Medical ID (iOS Health, or Android emergency information) so responders can reach them without unlocking. This app cannot place a widget on the lock screen while it runs through Expo Go.`}
        </Text>
      </View>

      <NoticeCard accent={colors.warn} background={colors.warnWash} border="rgba(217,119,6,0.35)">
        <Label color={colors.warnDeep}>THIS SCREEN IS NOT PRIVATE</Label>
        <Text style={[type.small, { color: colors.warnInk, marginTop: 6 }]}>
          Anyone who can see it can read these details. That is deliberate — the card has to work
          when there is no network and nobody can log in.
        </Text>
      </NoticeCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  qrPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xxl,
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 270,
    ...shadow('lift'),
  },
  qrFallback: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.slate,
    textAlign: 'center',
  },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  payload: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 18,
    color: colors.inkSoft,
    marginTop: 9,
  },
});
