/**
 * Language — the design's `isLanguage` screen.
 *
 * ---------------------------------------------------------------------------
 * TWO SENTENCES ON THIS SCREEN ARE LOAD-BEARING AND BOTH ARE KEPT VERBATIM.
 *
 *   "Changing this never restarts your case."
 *
 * Someone mid-interview, frightened, in the wrong language, must be able to
 * switch without fearing they will lose what they have already said. If they
 * cannot be sure of that, they will keep struggling in English — which is worse
 * than any translation error.
 *
 *   "Risk tiers, allowed outcomes and safety gates are identical in every
 *    language."
 *
 * The model translates the WORDS. It does not translate the decision. Tier,
 * routing policy and the press-and-hold gate all live in `@triage/shared` and
 * are computed before any language is chosen — a Hindi speaker and an English
 * speaker with identical symptoms get identical outcomes, and the screen says
 * so out loud rather than leaving it to be assumed.
 * ---------------------------------------------------------------------------
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Language } from '@triage/shared';
import { BackLink, Glass } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

interface Props {
  readonly current: Language;
  readonly onSelect: (language: Language) => void;
  readonly onBack: () => void;
}

/**
 * Native script first; the English name is the subtitle.
 *
 * A language picker that lists "Hindi" rather than "हिन्दी" is only usable by
 * someone who already reads English — which is exactly the person who does not
 * need it.
 */
const LANGUAGES: readonly { readonly code: Language; readonly native: string; readonly english: string }[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
];

export function LanguageScreen({ current, onSelect, onBack }: Props) {
  return (
    <View style={styles.root}>
      <BackLink onPress={onBack} />

      <Text style={type.h1}>Language</Text>
      <Text style={[type.small, { marginTop: -6 }]}>Changing this never restarts your case.</Text>

      <View style={styles.list}>
        {LANGUAGES.map((language) => {
          const selected = language.code === current;
          return (
            <Pressable key={language.code} onPress={() => onSelect(language.code)}>
              {({ pressed }) => {
                const body = (
                  <>
                    <View style={{ flex: 1 }}>
                      {/* Generous line-height: Devanagari, Telugu and Tamil all
                          have ascenders and descenders that English does not,
                          and a tight box clips them on Android. */}
                      <Text style={styles.native}>{language.native}</Text>
                      <Text style={[type.small, { marginTop: 2, fontSize: 11 }]}>{language.english}</Text>
                    </View>
                    {selected ? (
                      <View style={styles.check}>
                        <Text style={styles.checkGlyph}>✓</Text>
                      </View>
                    ) : null}
                  </>
                );
                // Selected stays a solid tinted card, deliberately: the one
                // row that most needs to read clearly at a glance is the one
                // already chosen, and a frosted background is the wrong place
                // to spend contrast.
                return selected ? (
                  <View style={[styles.rowSelected, pressed ? { transform: [{ scale: 0.98 }] } : null]}>
                    {body}
                  </View>
                ) : (
                  <Glass
                    tone="plain"
                    style={pressed ? { transform: [{ scale: 0.98 }] } : null}
                    contentStyle={styles.row}
                  >
                    {body}
                  </Glass>
                );
              }}
            </Pressable>
          );
        })}
      </View>

      <Text style={[type.foot, { marginTop: 4 }]}>
        Translation preserves tone as well as literal meaning. Risk tiers, allowed outcomes and
        safety gates are identical in every language.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  list: { gap: spacing.md, marginTop: 4 },
  row: {
    borderRadius: radius.lg,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSelected: {
    backgroundColor: 'rgba(29,78,216,0.1)',
    borderWidth: 2,
    borderColor: colors.brand,
    borderRadius: radius.lg,
    padding: 17,
    flexDirection: 'row',
    alignItems: 'center',
  },
  native: { fontFamily: fonts.sansBold, fontSize: 21, lineHeight: 32, color: colors.ink },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.white },
});
