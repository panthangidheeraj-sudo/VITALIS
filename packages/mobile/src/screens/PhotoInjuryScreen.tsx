/**
 * Screen 8 - Injury photo assessment (5.7).
 *
 * ROUGH LAYOUT. Structure only.
 *
 * KNOWN GAP, stated on the screen rather than hidden: the Groq account
 * currently has no vision-capable model, so this path is wired but unverified.
 * The screen therefore renders its own unavailable state instead of pretending
 * to analyse and silently returning nothing.
 *
 * WHAT THIS IS AND IS NOT (5.7): a vision API call that DESCRIBES what is
 * visible. It is not a trained classifier and it does not name a condition. The
 * description becomes one more piece of evidence - `photo_observation` - and
 * the clinical scoring engine decides what it means, exactly as it does for a
 * typed symptom. A photo is an extra observation, never a shortcut past triage.
 *
 * No image picker dependency yet; the capture button is a placeholder. Adding
 * expo-image-picker is a one-line swap at `onPickPhoto`.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  readonly onBack: () => void;
  /** Wired later to api.submitPhoto(caseId, ref). */
  readonly onSubmit?: (photoRef: string) => Promise<void>;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'selected'; readonly ref: string }
  | { readonly kind: 'analysing' }
  | { readonly kind: 'unavailable' };

export function PhotoInjuryScreen({ onBack, onSubmit }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const pickPhoto = () => {
    // Placeholder for expo-image-picker. The ref is what crosses the wire -
    // never the image bytes, and never a data URL in case state.
    setStatus({ kind: 'selected', ref: 'photo_placeholder_ref' });
  };

  const analyse = async () => {
    if (status.kind !== 'selected') return;
    setStatus({ kind: 'analysing' });
    try {
      await onSubmit?.(status.ref);
      // No vision model on the account yet - see the file header.
      setStatus({ kind: 'unavailable' });
    } catch {
      setStatus({ kind: 'unavailable' });
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Add a photo</Text>
      <Text style={type.small}>
        Optional. A photo of a visible injury gives the assistant one more thing to work from.
      </Text>

      <View style={styles.frame}>
        {status.kind === 'idle' ? (
          <Text style={styles.frameHint}>No photo selected</Text>
        ) : status.kind === 'analysing' ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.frameHint}>Describing what is visible...</Text>
          </>
        ) : (
          <Text style={styles.frameHint}>Photo ready</Text>
        )}
      </View>

      <Pressable style={styles.primaryButton} onPress={pickPhoto}>
        <Text style={styles.primaryText}>
          {status.kind === 'idle' ? 'Take or choose a photo' : 'Choose a different photo'}
        </Text>
      </Pressable>

      {status.kind === 'selected' ? (
        <Pressable style={styles.secondaryButton} onPress={() => void analyse()}>
          <Text style={styles.secondaryText}>Use this photo</Text>
        </Pressable>
      ) : null}

      {status.kind === 'unavailable' ? (
        <View style={styles.noticeCard}>
          <Text style={type.h3}>Photo assessment is unavailable</Text>
          <Text style={type.small}>
            The image description service is not reachable right now. Nothing has been added to your
            case, and your assessment is unaffected. Describe what you can see instead.
          </Text>
        </View>
      ) : null}

      {/* Said before the photo is taken, not after. */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>WHAT HAPPENS TO THIS PHOTO</Text>
        <Text style={type.small}>
          It is described - bleeding, swelling, burns, discolouration - and that description is added
          to your case as one more observation. The description never names a condition, and the
          risk level is decided by the same clinical engine either way.
        </Text>
        <Text style={type.tiny}>
          A blurry or dark photo is reported as low quality rather than guessed at.
        </Text>
      </View>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Skip</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },

  frame: {
    height: 220,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  frameHint: { ...type.small },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: '700' },

  noticeCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },

  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
