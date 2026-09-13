/**
 * The emergency card — the design's `isCard` screen.
 *
 * ---------------------------------------------------------------------------
 * THE TYPE SIZES ARE THE DESIGN, AND THEY ARE NOT DECORATIVE.
 *
 * Blood group at 52px and allergies at 26px are not styling choices — this card
 * is read by a stranger, at arm's length, in bad light, possibly through a
 * cracked screen, while someone is on the floor. The two facts that change what
 * a responder does in the first sixty seconds are the two that are enormous.
 *
 * Everything else on the screen is deliberately quieter than those two.
 * ---------------------------------------------------------------------------
 *
 * It opens with no network and no passcode. All of it is device-local, which is
 * also why it is still demo data — the profile editor is not built yet, and the
 * screen says so rather than implying a responder is reading something the user
 * entered.
 */

import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { DEMO_CONTACTS, DEMO_DEMOGRAPHICS, DEMO_EMERGENCY_CARD } from '../data/demoProfile';
import { BackLink, Glass, Label } from '../ui/primitives';
import { colors, fonts, radius, shadow, spacing, type } from '../theme';

export function EmergencyCardScreen({ onBack }: { readonly onBack: () => void }) {
  const card = DEMO_EMERGENCY_CARD;

  return (
    <View style={styles.root}>
      <BackLink onPress={onBack} />

      <Text style={type.h1}>Emergency card</Text>
      <Text style={[type.small, { marginTop: -6 }]}>
        Stored on this device. Opens without a passcode or a signal.
      </Text>

      {/* Higher intensity than the app's usual glass, deliberately: this card
          is read by a stranger, at arm's length, in bad light, and the
          97-alpha frosted look the rest of the app uses trades a little too
          much contrast for that job. */}
      <Glass tone="strong" intensity={55} radius={radius.xxl} shadowLevel="lift" contentStyle={styles.hero}>
        <View style={styles.heroRow}>
          <View>
            <Label>BLOOD GROUP</Label>
            <Text style={styles.bloodGroup}>{card.bloodGroup ?? '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.name}>{DEMO_DEMOGRAPHICS.displayName ?? 'Unnamed'}</Text>
            <Text style={[type.small, { marginTop: 2 }]}>
              {`${DEMO_DEMOGRAPHICS.ageYears} · ${DEMO_DEMOGRAPHICS.sex}`}
            </Text>
            {card.organDonor === true ? <Text style={styles.donor}>ORGAN DONOR</Text> : null}
          </View>
        </View>

        <View style={styles.allergyBlock}>
          <Label>ALLERGIES</Label>
          <Text style={styles.allergies}>
            {card.allergies.length === 0 ? 'None known' : card.allergies.join('\n')}
          </Text>
        </View>
      </Glass>

      <Glass tone="plain" contentStyle={styles.card}>
        <Label>MEDICATIONS</Label>
        <Text style={styles.listText}>
          {card.medications.map((m) => m.reportedName).join('\n') || 'None'}
        </Text>
        <Text style={[type.foot, { marginTop: 7 }]}>
          RxNorm-normalised names only. Interactions are NOT checked — the RxNav interaction
          endpoint was retired in January 2024.
        </Text>

        <Label style={{ marginTop: 16 }}>CHRONIC CONDITIONS</Label>
        <Text style={styles.listText}>{card.chronicConditions.join(' · ') || 'None recorded'}</Text>
      </Glass>

      <Glass tone="plain" contentStyle={styles.contactCard}>
        <Label style={{ paddingTop: 12, paddingBottom: 4 }}>EMERGENCY CONTACTS</Label>
        {DEMO_CONTACTS.map((contact) => (
          <View key={contact.phone} style={styles.contactRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>
                {contact.name}
                {contact.isPrimary ? <Text style={styles.primaryTag}>{'  PRIMARY'}</Text> : null}
              </Text>
              <Text style={[type.small, { marginTop: 2 }]}>
                {`${contact.relationship} · ${contact.phone}`}
              </Text>
            </View>
            <Pressable
              onPress={() => void Linking.openURL(`tel:${contact.phone.replace(/\s/g, '')}`)}
              style={({ pressed }) => [
                contact.isPrimary ? styles.callPrimary : styles.callSecondary,
                pressed ? { transform: [{ scale: 0.95 }] } : null,
              ]}
            >
              <Text style={contact.isPrimary ? styles.callPrimaryText : styles.callSecondaryText}>
                Call
              </Text>
            </Pressable>
          </View>
        ))}
      </Glass>

      {card.notes === undefined ? null : (
        <Glass tone="plain" contentStyle={styles.card}>
          <Label>NOTES FOR RESPONDERS</Label>
          <Text style={styles.notes}>{card.notes}</Text>
          <Text style={[type.foot, { marginTop: 9 }]}>
            {`Updated ${new Date(card.updatedAt).toLocaleString()}`}
          </Text>
        </Glass>
      )}

      {/* Said plainly rather than implied. A responder must not assume the
          patient typed this. */}
      <Text style={styles.sampleNote}>
        This card is sample data. The profile editor is not built yet, so nothing here was entered
        by the person holding the phone.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  hero: { borderRadius: radius.xxl, padding: spacing.xxl, ...shadow('lift') },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  bloodGroup: {
    fontFamily: fonts.sansBlack,
    fontSize: 52,
    lineHeight: 54,
    color: colors.dangerDeep,
    marginTop: 10,
    letterSpacing: -2,
  },
  name: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.ink },
  donor: { fontFamily: fonts.monoBold, fontSize: 9.5, color: colors.ok, marginTop: 8, letterSpacing: 0.6 },
  allergyBlock: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.09)',
  },
  allergies: {
    fontFamily: fonts.sansBlack,
    fontSize: 26,
    lineHeight: 32,
    color: colors.dangerDeep,
    marginTop: 9,
    letterSpacing: -0.5,
  },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  listText: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 24, color: colors.ink, marginTop: 9 },
  contactCard: { paddingHorizontal: spacing.xl, borderRadius: radius.lg },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.07)',
  },
  contactName: { fontFamily: fonts.sansBold, fontSize: 13.5, color: colors.ink },
  primaryTag: { fontFamily: fonts.monoSemi, fontSize: 9.5, color: colors.brand, letterSpacing: 0.6 },
  callPrimary: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  callPrimaryText: { fontFamily: fonts.sansBold, fontSize: 11.5, color: colors.white },
  callSecondary: {
    backgroundColor: 'rgba(29,78,216,0.1)',
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  callSecondaryText: { fontFamily: fonts.sansBold, fontSize: 11.5, color: colors.brand },
  notes: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, color: colors.ink, marginTop: 9 },
  sampleNote: { ...type.foot, textAlign: 'center' },
});
