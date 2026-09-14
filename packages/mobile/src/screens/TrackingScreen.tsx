/**
 * Live tracking — the design's `isTracking` screen.
 *
 * Everything on it is real: the hospital is whatever OpenStreetMap matched, the
 * distance is measured, the timeline is the Firestore stream. The design's
 * "AIIMS Bhubaneswar · AMB-14 · ETA 9" was placeholder text and is gone.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS SCREEN IS CAREFUL ABOUT
 *
 * 1. CANCEL IS PINNED, NOT SCROLLED. Spec §5.2 requires cancelling to be always
 *    available, and a Cancel Alert that is three screens down the scroll is
 *    available only in a lawyer's sense. It sits in a fixed footer and the tab
 *    bar is hidden here, so nothing competes with it.
 *
 * 2. THE SIMULATED PARTS ARE LABELLED WHERE THEY APPEAR. Dispatch is simulated;
 *    the hospital's coordinates, name and address are not. (Bed availability
 *    used to be simulated here too — it has been removed outright rather than
 *    labelled, since no public API publishes it.) Those notes sit next to the
 *    values rather than in a footnote, because a disclaimer at the bottom of a
 *    scroll is read by nobody.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CaseId } from '@triage/shared';
import { api, ApiError } from '../api/client';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { clockTime } from '../state/caseView';
import { MapPanel } from '../components/MapPanel';
import {
  Glass,
  DangerOutlineButton,
  Label,
  NoticeCard,
  Stat,
  TimelineStrip,
} from '../ui/primitives';
import { colors, dangerWash, fonts, radius, shadow, spacing, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onCancelled: () => void;
  readonly onOpenCompanion: () => void;
  readonly onOpenHandoff: () => void;
}

export function TrackingScreen({ caseId, onCancelled, onOpenCompanion, onOpenHandoff }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.cancel(caseId);
      onCancelled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel. Try again.');
    } finally {
      setBusy(false);
    }
  }, [caseId, onCancelled]);

  const match = state?.hospital;
  const dispatch = state?.dispatch;
  const timeline = (live.timeline ?? []).map((entry) => ({
    at: clockTime(entry.at),
    text: entry.summary,
  }));

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={dangerWash.colors}
        start={dangerWash.start}
        end={dangerWash.end}
        style={styles.hero}
      >
        <Label color="rgba(255,255,255,0.8)">
          {`${(state?.risk.tier ?? 'red').toUpperCase()} · CASE ${shortId(caseId)}`}
        </Label>
        <Text style={styles.heroTitle}>Help is on the way</Text>
        <Text style={styles.heroBody}>
          {dispatch?.requestedAt === undefined
            ? 'Your request has been recorded. Stay where you are and keep the phone with you.'
            : `Requested at ${clockTime(dispatch.requestedAt)}. Stay where you are and keep the phone with you.`}
        </Text>
        {/* Not buried. The dispatch is simulated and the screen says so at the
            top, where somebody reading only the headline will still see it. */}
        <Text style={styles.heroNote}>
          Dispatch is SIMULATED in this build — no emergency service has been contacted.
        </Text>
      </LinearGradient>

      <MapPanel
        origin={state?.lastKnownLocation}
        destination={
          match === undefined
            ? undefined
            : { ...match.hospital.location, name: match.hospital.name }
        }
      />

      <View style={styles.statRow}>
        <Stat
          label="ETA"
          value={match?.estimatedTravelMinutes ?? '—'}
          unit={match === undefined ? undefined : ' min'}
        />
        <Stat label="DISTANCE" value={match === undefined ? '—' : match.distanceKm.toFixed(1)} unit=" km" />
        <Stat label="STATUS" value={statusWord(dispatch?.status)} valueStyle={styles.statWord} />
      </View>

      <Glass tone="plain" contentStyle={styles.card}>
        <Label>DESTINATION</Label>
        {match === undefined ? (
          <>
            <Text style={[type.h3, { marginTop: 9, fontSize: 15 }]}>No hospital matched</Text>
            <Text style={[type.foot, { marginTop: 6 }]}>
              Matching needs your location, and it was not shared or could not be read. The
              dispatch itself is unaffected — the responder will route you.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.hospitalName}>{match.hospital.name}</Text>
            <Text style={[type.small, { marginTop: 3 }]}>
              {match.hospital.address ?? 'Address not recorded in OpenStreetMap'}
            </Text>
            <Text style={styles.provenance}>
              Coordinates, name and address from OpenStreetMap. Call ahead to confirm — bed
              availability is not published anywhere and is never shown here.
            </Text>
            {match.hospital.phone === undefined ? null : (
              <Text style={[type.mono, { marginTop: 10, color: colors.brand }]}>
                {match.hospital.phone}
              </Text>
            )}
          </>
        )}
      </Glass>

      <Glass tone="plain" contentStyle={[styles.card, { paddingRight: 0 }]}>
        <Label style={{ marginBottom: 10 }}>LIVE TIMELINE</Label>
        {timeline.length === 0 ? (
          <Text style={type.foot}>Waiting for the first event.</Text>
        ) : (
          <TimelineStrip entries={timeline} activeIndex={timeline.length - 1} />
        )}
      </Glass>

      <View style={styles.linkRow}>
        <LinkCard title="Monitoring" sub="Trends and next check" onPress={onOpenCompanion} />
        <LinkCard title="Doctor handoff" sub="Clinical summary card" onPress={onOpenHandoff} />
      </View>

      {error === undefined ? null : (
        <NoticeCard accent={colors.danger} background={colors.dangerWash} border="rgba(220,38,38,0.3)">
          <Text style={[type.small, { color: colors.dangerInk }]}>{error}</Text>
        </NoticeCard>
      )}

      <View style={styles.cancelDock}>
        <DangerOutlineButton
          label={busy ? 'Cancelling…' : 'Cancel Alert'}
          onPress={busy ? undefined : () => void cancel()}
        />
      </View>
    </View>
  );
}

function LinkCard({
  title,
  sub,
  onPress,
}: {
  readonly title: string;
  readonly sub: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <Glass
          tone="blue"
          radius={18}
          style={[styles.linkCardFlex, pressed ? { transform: [{ scale: 0.96 }] } : null]}
          contentStyle={styles.linkCard}
        >
          <Text style={[type.h3, { fontSize: 12.5 }]}>{title}</Text>
          <Text style={[type.foot, { marginTop: 3 }]}>{sub}</Text>
        </Glass>
      )}
    </Pressable>
  );
}

function statusWord(status: string | undefined): string {
  if (status === 'dispatch_requested') return 'Requested';
  if (status === 'en_route') return 'En route';
  if (status === 'arrived') return 'Arrived';
  if (status === 'cancelled') return 'Cancelled';
  return 'Pending';
}

/** The last four characters, uppercased. Enough to read aloud over a phone. */
function shortId(caseId: string): string {
  return caseId.slice(-4).toUpperCase();
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  hero: { borderRadius: radius.xl, padding: 18, ...shadow('lift') },
  heroTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 24,
    lineHeight: 26,
    color: colors.white,
    marginTop: 9,
    letterSpacing: -0.4,
  },
  heroBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 5,
  },
  heroNote: {
    fontFamily: fonts.monoMedium,
    fontSize: 9.5,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 10,
  },
  statRow: { flexDirection: 'row', gap: 9 },
  statWord: { fontSize: 14, lineHeight: 18 },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  hospitalName: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.ink, marginTop: 9 },
  provenance: {
    ...type.foot,
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.07)',
  },
  linkRow: { flexDirection: 'row', gap: spacing.md },
  linkCardFlex: { flex: 1 },
  linkCard: { padding: 14 },
  cancelDock: { marginTop: spacing.xs },
});
