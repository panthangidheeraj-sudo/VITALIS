/**
 * Screen 6 - Language selection (5.6).
 *
 * ROUGH LAYOUT. Structure only.
 *
 * Two things this screen has to communicate, and they are easy to get wrong:
 *
 *  1. Each language is written IN that language. Someone who reads only Telugu
 *     cannot find "Telugu" in a list of English words, which is the entire
 *     population this feature exists for.
 *  2. Translation preserves TONE, not just meaning (8). The note at the bottom
 *     says so, because a user who has been told "we translate" reasonably
 *     expects a machine-literal result and may distrust a warm one.
 *
 * Switching language does NOT restart the case: evidence, risk and confidence
 * are language-independent, and losing an interview because someone changed
 * language mid-emergency would be indefensible.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language } from '@triage/shared';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  readonly current: Language;
  readonly onSelect: (language: Language) => void;
  readonly onBack: () => void;
}

/** Native-script name first; the English name is the subtitle, not the label. */
const NATIVE_NAME: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
  ta: 'தமிழ்',
};

export function LanguageScreen({ current, onSelect, onBack }: Props) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Language</Text>
      <Text style={type.small}>The assistant will speak and ask questions in this language.</Text>

      {SUPPORTED_LANGUAGES.map((code) => {
        const selected = code === current;
        return (
          <Pressable
            key={code}
            onPress={() => onSelect(code)}
            style={[styles.option, selected && styles.optionSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.native, selected && { color: colors.primary }]}>
                {NATIVE_NAME[code]}
              </Text>
              <Text style={type.small}>{LANGUAGE_LABELS[code]}</Text>
            </View>
            {/* Not colour alone - the selected row is also marked in text. */}
            {selected ? <Text style={styles.selectedMark}>SELECTED</Text> : null}
          </Pressable>
        );
      })}

      <View style={styles.noteCard}>
        <Text style={type.h3}>Tone is preserved, not just words</Text>
        <Text style={type.small}>
          An urgent instruction stays urgent and a calm one stays calm. Numbers, times and
          medication names are never translated.
        </Text>
      </View>

      <Text style={styles.caveat}>
        Changing language does not restart your case. Everything already recorded is kept.
      </Text>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  optionSelected: { borderColor: colors.primary, borderWidth: 2 },
  native: { fontSize: 22, fontWeight: '700', color: colors.text },
  selectedMark: { ...type.tiny, color: colors.primary, fontWeight: '700', letterSpacing: 0.6 },

  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  caveat: { ...type.tiny, textAlign: 'center' },
  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
