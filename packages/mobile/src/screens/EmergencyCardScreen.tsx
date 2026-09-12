/**
 * Screen 5 - One-Tap Emergency Card (5.6).
 *
 * ROUGH LAYOUT. Structure and information hierarchy only; final visual design
 * comes later.
 *
 * The ordering is the design decision worth keeping: blood group and allergies
 * sit at the top at the largest size, because the two questions a paramedic
 * asks an unconscious patient's phone are "what is their blood group" and "what
 * will kill them". Everything else can be scrolled to.
 *
 * The card is readable WITHOUT unlocking anything and without a network call -
 * it is local data. A card that needs a signal is not an emergency card.
 */

import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  DEMO_CONTACTS,
  DEMO_DEMOGRAPHICS,
  DEMO_EMERGENCY_CARD,
  type EmergencyContact,
} from '../data/demoProfile';
import { colors, radius, spacing, type } from '../theme';

export function EmergencyCardScreen({ onBack }: { readonly onBack: () => void }) {
  const card = DEMO_EMERGENCY_CARD;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={type.h1}>{DEMO_DEMOGRAPHICS.displayName}</Text>
        <Text style={type.small}>
          {DEMO_DEMOGRAPHICS.ageYears} years / {DEMO_DEMOGRAPHICS.sex}
        </Text>
      </View>

      {/* The two fields a paramedic needs first, sized accordingly. */}
      <View style={styles.criticalRow}>
        <View style={[styles.criticalCard, { backgroundColor: colors.dangerSoft }]}>
          <Text style={styles.criticalLabel}>BLOOD GROUP</Text>
          <Text style={styles.criticalValue}>{card.bloodGroup ?? 'UNKNOWN'}</Text>
        </View>
        <View style={[styles.criticalCard, { backgroundColor: colors.warningSoft }]}>
          <Text style={styles.criticalLabel}>ALLERGIES</Text>
          <Text style={styles.criticalValueSmall}>
            {card.allergies.length > 0 ? card.allergies.join(', ') : 'None reported'}
          </Text>
        </View>
      </View>

      <Section label="CURRENT MEDICATIONS">
        {card.medications.map((med) => (
          <View key={med.reportedName} style={styles.row}>
            <Text style={styles.rowMain}>{med.reportedName}</Text>
            {/* The RxNorm name is what a hospital system recognises; the
                patient's own wording is kept beside it, never replaced. */}
            {med.normalizedName !== undefined ? (
              <Text style={type.tiny}>RxNorm: {med.normalizedName}</Text>
            ) : null}
          </View>
        ))}
        <Text style={styles.caveat}>
          Names verified against RxNorm. Drug interactions are NOT checked.
        </Text>
      </Section>

      <Section label="CHRONIC CONDITIONS">
        <Text style={type.body}>{card.chronicConditions.join(' / ')}</Text>
      </Section>

      <Section label="EMERGENCY CONTACTS">
        {DEMO_CONTACTS.map((contact) => (
          <ContactRow key={contact.phone} contact={contact} />
        ))}
      </Section>

      {card.notes !== undefined ? (
        <Section label="NOTES FOR RESPONDERS">
          <Text style={type.body}>{card.notes}</Text>
        </Section>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={type.tiny}>
          {card.organDonor === true ? 'Registered organ donor' : 'Organ donor: not stated'}
        </Text>
        <Text style={type.tiny}>Updated {card.updatedAt.slice(0, 10)}</Text>
      </View>

      <Text style={styles.offlineNote}>
        This card is stored on the device and opens with no signal.
      </Text>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function ContactRow({ contact }: { readonly contact: EmergencyContact }) {
  return (
    <Pressable style={styles.contactRow} onPress={() => void Linking.openURL(`tel:${contact.phone}`)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowMain}>
          {contact.name}
          {contact.isPrimary ? '  -  PRIMARY' : ''}
        </Text>
        <Text style={type.small}>
          {contact.relationship} / {contact.phone}
        </Text>
      </View>
      <Text style={styles.callChip}>CALL</Text>
    </Pressable>
  );
}

function Section({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { gap: 2 },

  criticalRow: { flexDirection: 'row', gap: spacing.sm },
  criticalCard: { flex: 1, borderRadius: radius.md, padding: spacing.lg, minHeight: 96 },
  criticalLabel: { ...type.tiny, letterSpacing: 0.6, color: colors.text },
  criticalValue: { fontSize: 40, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  criticalValueSmall: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },
  row: { paddingVertical: spacing.xs },
  rowMain: { ...type.body, fontWeight: '600' },
  caveat: { ...type.tiny, marginTop: spacing.sm, fontStyle: 'italic' },

  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  callChip: {
    ...type.tiny,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  offlineNote: { ...type.tiny, textAlign: 'center', marginTop: spacing.sm },
  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
