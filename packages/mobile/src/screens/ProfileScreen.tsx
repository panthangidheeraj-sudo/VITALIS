/**
 * Profile — the real profile editor `demoProfile.ts` used to stand in for.
 *
 * Everything typed in here is what the Home greeting, the Emergency card, the
 * handoff card, and case creation's age/sex now actually read — see
 * `data/profileStore.ts`. Comma-separated text fields for allergies /
 * medications / chronic conditions rather than a chip-picker UI, deliberately:
 * a full tag-editor is more UI than this turn had room for, and a comma list
 * you can read back and edit is still real, user-entered data — nothing here
 * is a placeholder.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { BiologicalSex } from '@triage/shared';
import { useProfile, type ProfileContact } from '../data/profileStore';
import { BackLink, Glass, Label, PrimaryButton } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

function splitList(text: string): readonly string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ProfileScreen({ onBack }: { readonly onBack: () => void }) {
  const { profile, loading, save } = useProfile();

  const [displayName, setDisplayName] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [sex, setSex] = useState<BiologicalSex>('female');
  const [bloodGroup, setBloodGroup] = useState('');
  const [allergies, setAllergies] = useState('');
  const [medications, setMedications] = useState('');
  const [chronicConditions, setChronicConditions] = useState('');
  const [organDonor, setOrganDonor] = useState(false);
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<readonly ProfileContact[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loading) return;
    setDisplayName(profile.displayName);
    setAgeYears(profile.ageYears > 0 ? String(profile.ageYears) : '');
    setSex(profile.sex);
    setBloodGroup(profile.bloodGroup);
    setAllergies(profile.allergies.join(', '));
    setMedications(profile.medications.join(', '));
    setChronicConditions(profile.chronicConditions.join(', '));
    setOrganDonor(profile.organDonor);
    setNotes(profile.notes);
    setContacts(profile.contacts);
    // Only ever re-seeds from storage once loading finishes, not on every
    // keystroke — `loading` is the only intended dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const addContact = () => {
    setContacts((prev) => [
      ...prev,
      { id: `contact_${Date.now()}`, name: '', relationship: 'family', phone: '', isPrimary: prev.length === 0 },
    ]);
  };

  const updateContact = (id: string, patch: Partial<ProfileContact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const submit = () => {
    save({
      displayName: displayName.trim(),
      ageYears: Number(ageYears) || 0,
      sex,
      bloodGroup: bloodGroup.trim(),
      allergies: splitList(allergies),
      medications: splitList(medications),
      chronicConditions: splitList(chronicConditions),
      organDonor,
      notes: notes.trim(),
      contacts,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return null;

  return (
    <View style={styles.root}>
      <BackLink onPress={onBack} />
      <Text style={type.h1}>Your profile</Text>
      <Text style={[type.small, { marginTop: -6 }]}>
        Stored on this device. Feeds your emergency card, the handoff summary, and case creation.
      </Text>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>NAME</Label>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.faint} />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Label style={{ marginTop: 16 }}>AGE</Label>
            <TextInput style={styles.input} value={ageYears} onChangeText={setAgeYears} keyboardType="number-pad" placeholder="e.g. 34" placeholderTextColor={colors.faint} />
          </View>
          <View style={{ flex: 1 }}>
            <Label style={{ marginTop: 16 }}>SEX</Label>
            <View style={styles.sexRow}>
              {(['female', 'male'] as const).map((option) => (
                <Pressable key={option} onPress={() => setSex(option)} style={[styles.sexOption, sex === option ? styles.sexOptionSelected : null]}>
                  <Text style={[styles.sexOptionText, sex === option ? styles.sexOptionTextSelected : null]}>{option}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <Label style={{ marginTop: 16 }}>BLOOD GROUP</Label>
        <TextInput style={styles.input} value={bloodGroup} onChangeText={setBloodGroup} placeholder="e.g. O+" placeholderTextColor={colors.faint} autoCapitalize="characters" />
      </Glass>

      <Glass tone="plain" contentStyle={styles.card}>
        <Label>ALLERGIES (comma-separated)</Label>
        <TextInput style={styles.input} value={allergies} onChangeText={setAllergies} placeholder="e.g. Penicillin, peanuts" placeholderTextColor={colors.faint} />

        <Label style={{ marginTop: 16 }}>MEDICATIONS (comma-separated)</Label>
        <TextInput style={styles.input} value={medications} onChangeText={setMedications} placeholder="e.g. Metformin 500mg" placeholderTextColor={colors.faint} />

        <Label style={{ marginTop: 16 }}>CHRONIC CONDITIONS (comma-separated)</Label>
        <TextInput style={styles.input} value={chronicConditions} onChangeText={setChronicConditions} placeholder="e.g. Hypertension" placeholderTextColor={colors.faint} />

        <View style={styles.donorRow}>
          <Text style={type.body}>Registered organ donor</Text>
          <Switch value={organDonor} onValueChange={setOrganDonor} />
        </View>

        <Label style={{ marginTop: 6 }}>NOTES FOR RESPONDERS</Label>
        <TextInput style={[styles.input, styles.notesInput]} value={notes} onChangeText={setNotes} placeholder="Anything a responder should know" placeholderTextColor={colors.faint} multiline />
      </Glass>

      <Glass tone="plain" contentStyle={styles.card}>
        <View style={styles.sectionHead}>
          <Label>EMERGENCY CONTACTS</Label>
          <Pressable onPress={addContact} hitSlop={8}>
            <Text style={styles.addLink}>+ Add</Text>
          </Pressable>
        </View>
        {contacts.length === 0 ? (
          <Text style={[type.small, { marginTop: 8 }]}>No contacts added yet.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactBlock}>
              <TextInput style={styles.input} value={contact.name} onChangeText={(v) => updateContact(contact.id, { name: v })} placeholder="Name" placeholderTextColor={colors.faint} />
              <View style={styles.row}>
                <TextInput style={[styles.input, { flex: 1, marginTop: 8 }]} value={contact.relationship} onChangeText={(v) => updateContact(contact.id, { relationship: v })} placeholder="Relationship" placeholderTextColor={colors.faint} />
                <TextInput style={[styles.input, { flex: 1.3, marginTop: 8 }]} value={contact.phone} onChangeText={(v) => updateContact(contact.id, { phone: v })} placeholder="+91XXXXXXXXXX" placeholderTextColor={colors.faint} keyboardType="phone-pad" />
              </View>
              <View style={styles.contactActions}>
                <Pressable onPress={() => updateContact(contact.id, { isPrimary: true })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.radioDot, contact.isPrimary ? styles.radioDotOn : null]} />
                  <Text style={type.small}>Primary contact</Text>
                </Pressable>
                <Pressable onPress={() => removeContact(contact.id)}>
                  <Text style={styles.removeLink}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Glass>

      <PrimaryButton label={saved ? 'Saved' : 'Save profile'} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  input: {
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 9,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  notesInput: { minHeight: 70, textAlignVertical: 'top' },
  sexRow: { flexDirection: 'row', gap: 8, marginTop: 9 },
  sexOption: { flex: 1, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: 1, borderColor: colors.hairline },
  sexOptionSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  sexOptionText: { fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink, textTransform: 'capitalize' },
  sexOptionTextSelected: { color: colors.white },
  donorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.brand },
  contactBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.divider },
  contactActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  radioDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.brand },
  radioDotOn: { backgroundColor: colors.brand },
  removeLink: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.dangerDeep },
});
