/**
 * Injury photo — the design's `isPhoto` screen (spec §5.7).
 *
 * ---------------------------------------------------------------------------
 * THE FRAMING IS THE SAFETY PROPERTY.
 *
 * The design's own line, kept: a photo "adds one observation to your case — it
 * is not a shortcut past the interview, and your risk tier does not depend on
 * it." Both halves are literally true of the implementation: the vision port
 * returns a `PhotoObservation`, whose schema has nowhere to put a tier, and the
 * rule engine scores the resulting evidence exactly as it scores anything else.
 *
 * This screen has to say so, because a camera in a medical app strongly implies
 * "point it at the problem and it will tell you what is wrong" — and someone
 * who believes that may photograph an injury instead of answering the questions
 * that actually set the tier.
 * ---------------------------------------------------------------------------
 *
 * THE AVAILABILITY BANNER IS DRIVEN BY /health, NOT HARDCODED. The design says
 * "No vision model is enabled on this account", which was true when it was
 * drawn and is not true now — Gemini is live. A screen that tells you a working
 * feature is broken trains you to ignore it when it really is.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { BackLink, Glass, Label, NoticeCard, PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

interface Props {
  readonly onBack: () => void;
  /** Submits the photo as a turn. Absent when there is no open case. */
  readonly onSubmit?: (photoRef: string) => Promise<void>;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'selected'; readonly ref: string }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'failed'; readonly message: string };

export function PhotoInjuryScreen({ onBack, onSubmit }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [visionLive, setVisionLive] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((health) => {
        if (!cancelled) setVisionLive(health.visionEnabled === true);
      })
      .catch(() => {
        if (!cancelled) setVisionLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = useCallback(() => {
    // expo-image-picker is not installed, so there is no camera path yet. This
    // stands in for one WITHOUT pretending a picture was taken — a fake
    // thumbnail here would be the start of a fake assessment.
    setStatus({ kind: 'selected', ref: 'photo_placeholder_ref' });
  }, []);

  const send = useCallback(async () => {
    if (status.kind !== 'selected' || onSubmit === undefined) return;
    setStatus({ kind: 'sending' });
    try {
      await onSubmit(status.ref);
      setStatus({ kind: 'sent' });
    } catch (err) {
      setStatus({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The photo could not be added.',
      });
    }
  }, [onSubmit, status]);

  return (
    <View style={styles.root}>
      <BackLink label="Emergency" onPress={onBack} />

      <Text style={type.h1}>Photo of the injury</Text>
      <Text style={[type.body, { marginTop: -6 }]}>
        Optional. This adds one observation to your case — it is not a shortcut past the interview,
        and your risk tier does not depend on it.
      </Text>

      <View style={styles.viewfinder}>
        {status.kind === 'sending' ? (
          <>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.viewfinderHint}>Describing what is visible…</Text>
          </>
        ) : (
          <>
            <Label color="#5b6b83" style={{ letterSpacing: 0.6 }}>
              CAMERA VIEWFINDER
            </Label>
            <Text style={styles.viewfinderHint}>
              {status.kind === 'idle' ? 'No photo selected yet' : 'Photo ready to send'}
            </Text>
          </>
        )}
      </View>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>BEFORE YOU TAKE IT</Label>
        <Text style={[type.body, { color: colors.inkSoft, marginTop: 9 }]}>
          The photo is attached to this case only, and travels with your handoff card to the
          receiving hospital. The agent describes what is visible — bleeding, swelling, burns. It
          never names a condition and it cannot set your risk level.
        </Text>
      </Glass>

      {visionLive === false ? (
        <NoticeCard accent={colors.warn} background={colors.warnWash} border="rgba(217,119,6,0.35)">
          <Label color={colors.warnDeep}>UNAVAILABLE RIGHT NOW</Label>
          <Text style={[type.body, { color: colors.warnInk, marginTop: 8 }]}>
            No vision model is enabled on this server, so a photo cannot be read yet. You can still
            attach it for the hospital. Keep answering the interview — that is what sets your risk
            tier.
          </Text>
        </NoticeCard>
      ) : visionLive === true ? (
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={[type.foot, { flex: 1 }]}>
            Photo reading is available. It describes what is visible and nothing more.
          </Text>
        </View>
      ) : null}

      {status.kind === 'sent' ? (
        <NoticeCard accent={colors.ok} background="rgba(21,128,61,0.1)" border="rgba(21,128,61,0.3)">
          <Label color={colors.ok}>ADDED TO YOUR CASE</Label>
          <Text style={[type.small, { color: colors.inkSoft, marginTop: 6 }]}>
            The observation is on the record. Go back and keep answering — the interview is what
            moves your tier.
          </Text>
        </NoticeCard>
      ) : null}

      {status.kind === 'failed' ? (
        <NoticeCard accent={colors.danger} background={colors.dangerWash} border="rgba(220,38,38,0.3)">
          <Label color={colors.dangerDeep}>COULD NOT ADD THE PHOTO</Label>
          <Text style={[type.small, { color: colors.dangerInk, marginTop: 6 }]}>
            {`${status.message} Your assessment does not depend on the image — describe what you can see instead.`}
          </Text>
        </NoticeCard>
      ) : null}

      <View style={styles.buttonRow}>
        <SecondaryButton
          label={status.kind === 'idle' ? 'Choose a photo' : 'Choose a different one'}
          onPress={pick}
          style={{ flex: 1 }}
        />
        <PrimaryButton
          label={status.kind === 'selected' ? 'Use this photo' : 'Skip, continue'}
          onPress={status.kind === 'selected' ? () => void send() : onBack}
          busy={status.kind === 'sending'}
          style={{ flex: 1 }}
        />
      </View>

      {/* Stated plainly rather than left for someone to discover. */}
      <Text style={styles.note}>
        The camera is not wired up in this build — the button above stands in for it so the rest of
        the path can be shown end to end.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  viewfinder: {
    height: 230,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(29,78,216,0.35)',
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  viewfinderHint: { fontFamily: fonts.sans, fontSize: 11, color: colors.label },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  note: { ...type.foot, textAlign: 'center' },
});
