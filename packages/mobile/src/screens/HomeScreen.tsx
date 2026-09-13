/**
 * Health home — the design's `isHome` screen.
 *
 * Vitals, medication reminders, and the quick actions. Everything on it is
 * device-local and none of it can fail in a way that matters, which is why it
 * is the tab the app opens on rather than the emergency flow: opening straight
 * into a red screen would make the app feel like an alarm you carry around.
 *
 * VITALS ARE MANUALLY ENTERED, NOT READ FROM A DEVICE. There is no wearable
 * integration in this build and none was ever planned for it — see
 * `data/vitalsStore.ts` and `components/VitalsPanel.tsx` for the full
 * reasoning. Nothing on this screen implies a Bluetooth or continuous-monitor
 * source; every number here is something a person typed in from their own
 * home BP cuff, glucometer or oximeter.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { useProfile } from '../data/profileStore';
import { useAuth } from '../firebase/useAuth';
import { VitalsPanel } from '../components/VitalsPanel';
import { MedicationsPanel } from '../components/MedicationsPanel';
import { Wordmark } from '../ui/Chrome';
import { Card, Glass, Label, NoticeCard, PrimaryButton } from '../ui/primitives';
import { FadeUp, Pulse } from '../ui/motion';
import { colors, fonts, radius, spacing, type } from '../theme';

interface Props {
  readonly onStartEmergency: () => void;
  readonly onOpenFirstAid: () => void;
  readonly onOpenEmergencyCard: () => void;
  readonly onOpenLanguage: () => void;
  readonly onOpenMedicine: () => void;
  readonly onOpenProfile: () => void;
}

export function HomeScreen({
  onStartEmergency,
  onOpenFirstAid,
  onOpenEmergencyCard,
  onOpenLanguage,
  onOpenMedicine,
  onOpenProfile,
}: Props) {
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);
  const [scorer, setScorer] = useState<string | undefined>(undefined);
  const auth = useAuth();
  const { profile, loading: profileLoading } = useProfile();

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((health) => {
        if (cancelled) return;
        setReachable(true);
        setScorer(health.clinicalScorer);
      })
      .catch(() => {
        if (!cancelled) setReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = profileLoading || profile.displayName.trim().length === 0 ? 'You' : profile.displayName;
  const initials = name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.root}>
      <Wordmark />

      <FadeUp style={styles.greetRow}>
        <View style={{ flex: 1 }}>
          <Label style={{ marginBottom: 7 }}>{today()}</Label>
          <Text style={type.serifDisplay}>
            {`Hello, ${profileLoading || profile.displayName.trim().length === 0 ? 'there' : profile.displayName.split(' ')[0]}`}
          </Text>
        </View>
        <Pressable onPress={onOpenProfile} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </FadeUp>

      {/* Connection state. The unreachable case names the actual cause, because
          `localhost` on a phone meaning "the phone" is the mistake that costs
          people an hour every single time. */}
      {reachable === false ? (
        <NoticeCard
          accent={colors.danger}
          background="rgba(254,226,226,0.82)"
          border="rgba(220,38,38,0.3)"
        >
          <Text style={styles.errTitle}>Orchestrator unreachable</Text>
          <Text style={[type.small, { color: colors.dangerInk, marginTop: 3 }]}>
            {`Set EXPO_PUBLIC_API_URL to your computer's LAN IP, not localhost, then restart Expo. First aid below still works.`}
          </Text>
        </NoticeCard>
      ) : (
        <View style={styles.connected}>
          {reachable === true ? (
            <Pulse periodMs={2400} style={[styles.dot, { backgroundColor: colors.ok }]} />
          ) : (
            <View style={[styles.dot, { backgroundColor: colors.faint }]} />
          )}
          <Text style={[styles.connLabel, reachable === undefined ? { color: colors.slate } : null]}>
            {reachable === undefined ? 'Checking…' : 'Connected'}
          </Text>
          <Text style={styles.connMeta}>
            {scorer === undefined ? '' : `Scoring: ${scorer.replace(/_/g, ' ')}`}
          </Text>
        </View>
      )}

      {/* The emergency entry point. Present on every screen via the tab bar, and
          given a full-width button here too — one tap from the app's first
          screen is the whole point of the product. */}
      <PrimaryButton label="Start emergency triage" onPress={onStartEmergency} />

      <VitalsPanel />

      <MedicationsPanel />

      {/* The quick actions. Grouped here rather than given tabs because none
          of them is somewhere you go — they are things you reach for once. */}
      <View style={styles.grid}>
        {/* Hierarchy (P2 #7): the two cards a responder — or the user under
            duress — reaches for FIRST get an icon, a coloured accent bar and a
            bolder title. The other three are equally functional, just quieter,
            because treating five unrelated actions as equally urgent is itself
            what "no hierarchy" looks like. */}
        <QuickAction
          index={0}
          icon="🩸"
          title="Emergency card"
          sub="Blood group, allergies, contacts"
          emphasis
          onPress={onOpenEmergencyCard}
        />
        <QuickAction
          index={1}
          icon="👤"
          title="Profile"
          sub="Your details and emergency contacts"
          emphasis
          onPress={onOpenProfile}
        />
        <QuickAction index={2} icon="💊" title="Medicine scanner" sub="Expiry, dose, what it is" onPress={onOpenMedicine} />
        <QuickAction index={3} icon="🩹" title="First aid" sub="Works with no signal" onPress={onOpenFirstAid} />
        <QuickAction index={4} icon="🌐" title="Language" sub="English · हिन्दी · తెలుగు · தமிழ்" onPress={onOpenLanguage} />
      </View>

      {/* Google sign-in. Framed as what it is FOR, never as "sign in to
          continue" — anonymous is primary and the app is fully usable without
          it. See firebase/useAuth.ts. */}
      {auth.canUpgrade ? (
        <Card tone="plain">
          <Label>KEEP YOUR MEDICAL ID</Label>
          <Text style={[type.small, { color: colors.inkSoft, marginTop: 8 }]}>
            Your card and case history live on this device only. Linking a Google account carries
            them to a new phone. Nothing is shared and you are never asked to sign in to get help.
          </Text>
          <PrimaryButton
            label={auth.signingIn ? 'Opening Google…' : 'Link a Google account'}
            onPress={() => void auth.signIn()}
            busy={auth.signingIn}
            style={{ marginTop: spacing.lg }}
          />
          {auth.error === undefined ? null : (
            <Text style={[type.foot, { color: colors.dangerDeep, marginTop: 8 }]}>{auth.error}</Text>
          )}
        </Card>
      ) : auth.isUpgraded ? (
        <View style={styles.signedIn}>
          <View style={[styles.dot, { backgroundColor: colors.ok }]} />
          <Text style={[type.foot, { flex: 1 }]}>
            {`Signed in as ${auth.email ?? 'your Google account'} — your medical ID moves with you.`}
          </Text>
        </View>
      ) : null}

      <Text style={styles.disclaimer}>
        {`Decision support in a simulated environment.\nNot a medical device. Never diagnoses or prescribes.`}
      </Text>
      {!profileLoading && profile.updatedAt !== undefined ? (
        <Text style={styles.cardMeta}>
          {`Emergency card last updated ${new Date(profile.updatedAt).toLocaleDateString()}`}
        </Text>
      ) : null}
    </View>
  );
}

function QuickAction({
  icon,
  title,
  sub,
  emphasis = false,
  index,
  onPress,
}: {
  readonly icon: string;
  readonly title: string;
  readonly sub: string;
  /** The two highest-priority cards — see the call site's comment. */
  readonly emphasis?: boolean;
  /** Staggers this tile's entrance — `vfadeup ... .2s/.25s/... both` in the design. */
  readonly index: number;
  readonly onPress: () => void;
}) {
  return (
    <FadeUp delayMs={200 + index * 40} style={styles.quickFlex}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <Glass
            tone={emphasis ? 'strong' : 'blue'}
            style={[emphasis ? styles.quickEmphasisBorder : null, pressed ? { transform: [{ scale: 0.96 }] } : null]}
            contentStyle={styles.quick}
          >
            <View style={[styles.quickIcon, emphasis ? styles.quickIconEmphasis : null]}>
              <Text style={styles.quickIconGlyph}>{icon}</Text>
            </View>
            <Text style={[type.h3, emphasis ? styles.quickTitleEmphasis : null]}>{title}</Text>
            <Text style={[type.foot, { marginTop: 4 }]}>{sub}</Text>
          </Glass>
        )}
      </Pressable>
    </FadeUp>
  );
}

function today(): string {
  return new Date()
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
}

const styles = StyleSheet.create({
  root: { gap: spacing.xxl },
  greetRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.brand },

  errTitle: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.dangerDeep },
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  connLabel: { fontFamily: fonts.sansSemi, fontSize: 11.5, color: colors.ok },
  connMeta: { ...type.small, marginLeft: 'auto', fontSize: 11 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },

  quickFlex: { width: '48%', flexGrow: 1 },
  quickEmphasisBorder: { borderColor: 'rgba(220,38,38,0.28)', borderWidth: 1.5, borderRadius: radius.lg },
  quick: { padding: spacing.xl },
  quickIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(29,78,216,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  quickIconEmphasis: { backgroundColor: 'rgba(220,38,38,0.12)' },
  quickIconGlyph: { fontSize: 15 },
  quickTitleEmphasis: { color: colors.dangerDeep },

  signedIn: {
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

  disclaimer: {
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
    color: colors.labelDim,
    textAlign: 'center',
  },
  cardMeta: { ...type.foot, textAlign: 'center', marginTop: -14 },
});
