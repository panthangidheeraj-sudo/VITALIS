/**
 * Screen 3 - Live tracking (spec 9): map, ETA, direct contact number, and a
 * Cancel Alert control that is always available.
 *
 * "Cancel Alert" is rendered unconditionally and never hidden behind a menu or
 * a scroll - 5.2 requires it to stay available throughout, and a cancel
 * control you have to hunt for during an emergency is not really available.
 * It is a plain tap, not a press-and-hold: the gate exists to prevent
 * accidental DISPATCH, and making it hard to stand down would be backwards.
 *
 * The map is presentation only. If `react-native-maps` fails to render (a known
 * Expo Go issue on some SDK versions), `MapPanel` falls back to a coordinate
 * card - the ETA, destination and cancel control all still work, because none
 * of the judged behaviour lives in the map.
 */

import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CaseId } from '@triage/shared';
import { api, ApiError } from '../api/client';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { MapPanel } from '../components/MapPanel';
import { colors, radius, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onCancelled: () => void;
  readonly onOpenCompanion: () => void;
  readonly onOpenHandoff: () => void;
}

export function TrackingScreen({
  caseId,
  onCancelled,
  onOpenCompanion,
  onOpenHandoff,
}: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const caseState = live.caseState;
  const dispatch = caseState?.dispatch;
  const hospital = caseState?.hospital;
  const tier = caseState?.risk.tier ?? 'red';

  const cancel = useCallback(async () => {
    setCancelling(true);
    setError(undefined);
    try {
      await api.cancel(caseId);
      onCancelled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel. Try again.');
      setCancelling(false);
    }
  }, [caseId, onCancelled]);

  const destination = hospital?.hospital;
  const contactNumber = dispatch?.contactNumber;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.banner, { backgroundColor: tierColor[tier] }]}>
          <Text style={styles.bannerTitle}>Help is on the way</Text>
          <Text style={styles.bannerSub}>
            {tierLabel[tier]} / case {String(caseId).slice(0, 12)}
          </Text>
        </View>

        <MapPanel
          destination={
            destination === undefined
              ? undefined
              : {
                  lat: destination.location.lat,
                  lng: destination.location.lng,
                  name: destination.name,
                }
          }
          origin={
            caseState?.lastKnownLocation === undefined
              ? undefined
              : {
                  lat: caseState.lastKnownLocation.lat,
                  lng: caseState.lastKnownLocation.lng,
                }
          }
        />

        <View style={styles.statRow}>
          <Stat
            label="ETA"
            value={dispatch?.etaMinutes === undefined ? 'n/a' : `${dispatch.etaMinutes} min`}
          />
          <Stat label="STATUS" value={(dispatch?.status ?? 'pending').replace(/_/g, ' ')} />
          <Stat label="UNIT" value={dispatch?.unitLabel ?? 'n/a'} />
        </View>

        {destination !== undefined ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>DESTINATION</Text>
            <Text style={type.h3}>{destination.name}</Text>
            {destination.address !== undefined ? (
              <Text style={type.small}>{destination.address}</Text>
            ) : null}
            <Text style={styles.provenance}>
              Location from OpenStreetMap. Specialty and bed availability are simulated.
            </Text>
          </View>
        ) : null}

        {contactNumber !== undefined ? (
          <Pressable
            style={styles.callButton}
            onPress={() => void Linking.openURL(`tel:${contactNumber}`)}
          >
            <Text style={styles.callText}>Call {contactNumber}</Text>
          </Pressable>
        ) : null}

        {live.timeline.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>TIMELINE</Text>
            {live.timeline.slice(-6).map((entry) => (
              <View key={entry.id} style={styles.timelineRow}>
                <Text style={styles.timelineTime}>{entry.at.slice(11, 16)}</Text>
                <Text style={styles.timelineText}>{entry.summary}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.utilityRow}>
          <Pressable style={styles.utilityButton} onPress={onOpenCompanion}>
            <Text style={styles.utilityText}>Monitoring</Text>
            <Text style={type.tiny}>Trends and next check</Text>
          </Pressable>
          <Pressable style={styles.utilityButton} onPress={onOpenHandoff}>
            <Text style={styles.utilityText}>Doctor handoff</Text>
            <Text style={type.tiny}>Clinical summary card</Text>
          </Pressable>
        </View>

        {error !== undefined ? <Text style={styles.inlineError}>{error}</Text> : null}
        <View style={{ height: 96 }} />
      </ScrollView>

      {/* Always visible, never scrolled away (5.2). */}
      <View style={styles.cancelBar}>
        <Pressable
          style={[styles.cancelButton, cancelling && styles.cancelDisabled]}
          onPress={() => void cancel()}
          disabled={cancelling}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{cancelling ? 'Cancelling...' : 'Cancel Alert'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },

  banner: { borderRadius: radius.lg, padding: spacing.lg },
  bannerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  bannerSub: { color: '#FFFFFFCC', fontSize: 13, marginTop: 2 },

  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statLabel: { ...type.tiny, letterSpacing: 0.6 },
  statValue: { fontSize: 17, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 2,
  },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },
  provenance: { ...type.tiny, marginTop: spacing.sm },

  callButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  callText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  timelineRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  timelineTime: { ...type.mono, width: 44 },
  timelineText: { ...type.small, flex: 1, color: colors.text },

  inlineError: { ...type.small, color: colors.danger },

  utilityRow: { flexDirection: 'row', gap: spacing.sm },
  utilityButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  utilityText: { fontSize: 14, fontWeight: '700', color: colors.text },

  cancelBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.danger,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cancelDisabled: { opacity: 0.6 },
  cancelText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
});
