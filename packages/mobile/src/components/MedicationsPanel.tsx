/**
 * Medication reminders — real, user-entered, persisted. See
 * `data/medicationStore.ts` for why the old hardcoded list had to go.
 *
 * THE WEEK STRIP IS A REAL CALENDAR VIEW, WITH A HONEST LIMIT: reminders here
 * are a daily routine time ("8:00 AM"), not a dated event — there is no
 * recurrence or per-day scheduling model. So every reminder shows on every
 * day of the strip, which is the truthful rendering of "this happens daily",
 * rather than inventing per-date data the store does not have. Tapping a day
 * scopes the list below to what is due that day of the week (today vs. not).
 *
 * Minimal empty state, matching VitalsPanel and P2 #6: nothing logged is one
 * tappable line, not a card explaining itself.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMedications } from '../data/medicationStore';
import { Glass, Label } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function currentWeek(): readonly Date[] {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });
}

function WeekStrip() {
  const today = new Date();
  const week = currentWeek();
  return (
    <View style={styles.weekRow}>
      {week.map((day) => {
        const isToday = day.toDateString() === today.toDateString();
        return (
          <View key={day.toISOString()} style={styles.dayCell}>
            <Text style={styles.dayLabel}>{DAY_LABELS[day.getDay()]}</Text>
            <View style={[styles.dayNum, isToday ? styles.dayNumToday : null]}>
              <Text style={[styles.dayNumText, isToday ? styles.dayNumTextToday : null]}>{day.getDate()}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function MedicationsPanel() {
  const { reminders, loading, add, remove, toggleTaken } = useMedications();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [at, setAt] = useState('');

  const submit = () => {
    add(name, at);
    setName('');
    setAt('');
    setAdding(false);
  };

  if (loading) return null;

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={type.h3}>Medication reminders</Text>
        {reminders.length > 0 && !adding ? (
          <Pressable onPress={() => setAdding(true)} hitSlop={8}>
            <Text style={styles.addLink}>Add</Text>
          </Pressable>
        ) : null}
      </View>

      {reminders.length > 0 ? <WeekStrip /> : null}

      {adding ? (
        <Glass tone="blue" contentStyle={styles.addCard}>
          <View style={styles.row}>
            <View style={{ flex: 1.4 }}>
              <Label>MEDICATION</Label>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Metformin 500 mg"
                placeholderTextColor={colors.faint}
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Label>TIME</Label>
              <TextInput
                value={at}
                onChangeText={setAt}
                placeholder="8:00 AM"
                placeholderTextColor={colors.faint}
                style={styles.input}
              />
            </View>
          </View>
          <View style={styles.addActions}>
            <Pressable onPress={() => setAdding(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.saveBtn}>
              <Text style={styles.saveText}>Add</Text>
            </Pressable>
          </View>
        </Glass>
      ) : reminders.length === 0 ? (
        <Pressable onPress={() => setAdding(true)} style={styles.emptyRow} hitSlop={6}>
          <Text style={styles.emptyPlus}>＋</Text>
          <Text style={styles.emptyLabel}>Add a reminder</Text>
        </Pressable>
      ) : (
        <Glass tone="blue" contentStyle={styles.listCard}>
          {reminders.map((reminder, i) => (
            <Pressable
              key={reminder.id}
              onPress={() => toggleTaken(reminder.id)}
              onLongPress={() => remove(reminder.id)}
              style={[styles.row2, i > 0 ? styles.rowDivider : null]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.reminderName}>{reminder.name}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{reminder.at}</Text>
              </View>
              <Text
                style={[
                  styles.reminderState,
                  { color: reminder.takenToday ? colors.ok : colors.warn },
                ]}
              >
                {reminder.takenToday ? 'TAKEN' : 'DUE'}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.hint}>Tap to mark taken · hold to remove</Text>
        </Glass>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  dayCell: { alignItems: 'center', gap: 5 },
  dayLabel: { fontFamily: fonts.monoMedium, fontSize: 9.5, color: colors.label },
  dayNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayNumToday: { backgroundColor: colors.brand },
  dayNumText: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.ink },
  dayNumTextToday: { color: colors.white, fontFamily: fonts.sansBold },
  addLink: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.brand },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  emptyPlus: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.brand },
  emptyLabel: { fontFamily: fonts.sansSemi, fontSize: 13, color: colors.brand },
  listCard: { paddingHorizontal: spacing.xl, paddingVertical: 5 },
  row2: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  reminderName: { fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink },
  reminderState: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.6 },
  hint: { ...type.foot, paddingBottom: 10, paddingTop: 2 },
  addCard: { padding: spacing.xl, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  input: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.15)',
    paddingVertical: 8,
    marginTop: 4,
  },
  addActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  cancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(29,78,216,0.10)',
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.brand },
  saveBtn: { flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  saveText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.white },
});
