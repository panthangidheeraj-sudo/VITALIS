/**
 * Health home — the design's `isHome` screen.
 *
 * Vitals, medication reminders, and the quick actions. Everything on it is
 * device-local and none of it can fail in a way that matters, which is why it
 * is the tab the app opens on rather than the emergency flow: opening straight
 * into a red screen would make the app feel like an alarm you carry around.
 *
 * THE VITALS ARE SAMPLE DATA AND SAY SO. There is no wearable integration and
 * no `patients/{uid}` document being read yet. The design puts a `SAMPLE DATA`
 * chip beside the heading for exactly this reason and it is kept verbatim —
 * a plausible blood-pressure reading with no provenance is the single most
 * misleading thing this screen could show.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { api } from '../api/client';
import { DEMO_DEMOGRAPHICS, DEMO_EMERGENCY_CARD } from '../data/demoProfile';
import { useAuth } from '../firebase/useAuth';
import { Wordmark } from '../ui/Chrome';
import { Card, Label, NoticeCard, PrimaryButton } from '../ui/primitives';
import { colors, fonts, glass, radius, spacing, type } from '../theme';

interface Props {
  readonly onStartEmergency: () => void;
  readonly onOpenFirstAid: () => void;
  readonly onOpenEmergencyCard: () => void;
  readonly onOpenLanguage: () => void;
  readonly onOpenQr: () => void;
  readonly onOpenMedicine: () => void;
  readonly onOpenSilent: () => void;
}

/** The design's own numbers, kept so the screen matches it beat for beat. */
const VITALS = { bpSys: 128, bpDia: 84, hr: 78, spo2: 97, glucose: 112 } as const;

const REMINDERS = [
  { name: 'Metformin 500 mg', at: '8:00 AM', state: 'TAKEN' as const },
  { name: 'Amlodipine 5 mg', at: '9:00 PM', state: 'DUE' as const },
];

export function HomeScreen({
  onStartEmergency,
  onOpenFirstAid,
  onOpenEmergencyCard,
  onOpenLanguage,
  onOpenQr,
  onOpenMedicine,
  onOpenSilent,
}: Props) {
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);
  const [scorer, setScorer] = useState<string | undefined>(undefined);
  const auth = useAuth();

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

  const initials = (DEMO_DEMOGRAPHICS.displayName ?? 'You')
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.root}>
      <Wordmark />

      <View style={styles.greetRow}>
        <View style={{ flex: 1 }}>
          <Label style={{ marginBottom: 7 }}>{today()}</Label>
          <Text style={type.serifDisplay}>
            {`Hello, ${(DEMO_DEMOGRAPHICS.displayName ?? 'there').split(' ')[0]}`}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </View>

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
          <View style={[styles.dot, { backgroundColor: reachable === undefined ? colors.faint : colors.ok }]} />
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

      <View>
        <View style={styles.sectionHead}>
          <Text style={type.h3}>{`Today's vitals`}</Text>
          <Text style={styles.sampleChip}>SAMPLE DATA</Text>
        </View>
        <View style={styles.grid}>
          <View style={[glass('blue'), styles.vital]}>
            <Label style={{ marginBottom: 10 }}>BLOOD PRESSURE</Label>
            <Text style={type.metric}>
              {VITALS.bpSys}
              <Text style={styles.metricSub}>/{VITALS.bpDia}</Text>
            </Text>
            <Text style={styles.unit}>mmHg</Text>
            <View style={styles.bars}>
              {[40, 62, 48, 78, 55, 88].map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.barCol,
                    {
                      height: `${h}%`,
                      backgroundColor: i === 5 ? colors.brand : 'rgba(29,78,216,0.22)',
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={[glass('blue'), styles.vital]}>
            <Label style={{ marginBottom: 10 }}>HEART RATE</Label>
            <Text style={type.metric}>{VITALS.hr}</Text>
            <Text style={styles.unit}>bpm</Text>
            <View style={styles.trace}>
              <Svg width="100%" height={22} viewBox="0 0 120 22" preserveAspectRatio="none">
                <Path
                  d="M0 14 L14 14 L20 5 L26 19 L32 14 L58 14 L64 6 L70 18 L76 14 L104 14 L110 8 L116 14 L120 14"
                  fill="none"
                  stroke={colors.brand}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </View>

          <View style={[glass('blue'), styles.vital, styles.spo2Row]}>
            <View style={{ flex: 1 }}>
              <Label style={{ marginBottom: 9 }}>SPO₂</Label>
              <Text style={type.metric}>
                {VITALS.spo2}
                <Text style={styles.metricSub}>%</Text>
              </Text>
            </View>
            <Svg width={42} height={42} viewBox="0 0 36 36">
              <Circle cx={18} cy={18} r={15} fill="none" stroke="rgba(29,78,216,0.14)" strokeWidth={3} />
              <Circle
                cx={18}
                cy={18}
                r={15}
                fill="none"
                stroke={colors.brand}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={94.2}
                strokeDashoffset={94.2 * (1 - VITALS.spo2 / 100)}
                transform="rotate(-90 18 18)"
              />
            </Svg>
          </View>

          <View style={[glass('blue'), styles.vital]}>
            <Label style={{ marginBottom: 10 }}>BLOOD GLUCOSE</Label>
            <Text style={type.metric}>{VITALS.glucose}</Text>
            <Text style={styles.unit}>mg/dL · fasting</Text>
            <View style={styles.glucoseTrack}>
              <View style={styles.glucoseFill} />
            </View>
          </View>
        </View>
      </View>

      <View>
        <Text style={[type.h3, { marginBottom: 9 }]}>Medication reminders</Text>
        <View style={[glass('blue'), styles.reminderCard]}>
          {REMINDERS.map((reminder, i) => (
            <View key={reminder.name} style={[styles.reminderRow, i > 0 ? styles.rowDivider : null]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reminderName}>{reminder.name}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{reminder.at}</Text>
              </View>
              <Text
                style={[
                  styles.reminderState,
                  { color: reminder.state === 'TAKEN' ? colors.ok : colors.warn },
                ]}
              >
                {reminder.state}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* The quick actions. The design shows two; this adds the QR card, the
          medicine scanner and silent distress, which exist in this build and
          had no slot in the design. They are grouped here rather than given tabs
          because none of them is somewhere you go — they are things you reach
          for once. */}
      <View style={styles.grid}>
        <QuickAction title="Emergency card" sub="Blood group, allergies, contacts" onPress={onOpenEmergencyCard} />
        <QuickAction title="Lock-screen QR" sub="Scannable by a responder" onPress={onOpenQr} />
        <QuickAction title="Medicine scanner" sub="Expiry, dose, what it is" onPress={onOpenMedicine} />
        <QuickAction title="Silent distress" sub="Get help without a sound" onPress={onOpenSilent} />
        <QuickAction title="First aid" sub="Works with no signal" onPress={onOpenFirstAid} />
        <QuickAction title="Language" sub="English · हिन्दी · తెలుగు · தமிழ்" onPress={onOpenLanguage} />
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
      <Text style={styles.cardMeta}>
        {`Emergency card last updated ${new Date(DEMO_EMERGENCY_CARD.updatedAt).toLocaleDateString()}`}
      </Text>
    </View>
  );
}

function QuickAction({
  title,
  sub,
  onPress,
}: {
  readonly title: string;
  readonly sub: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        glass('blue'),
        styles.quick,
        pressed ? { transform: [{ scale: 0.96 }] } : null,
      ]}
    >
      <Text style={type.h3}>{title}</Text>
      <Text style={[type.foot, { marginTop: 4 }]}>{sub}</Text>
    </Pressable>
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

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  sampleChip: { fontFamily: fonts.mono, fontSize: 10, color: colors.faint, letterSpacing: 0.6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  vital: { width: '48%', flexGrow: 1, padding: 14, borderRadius: radius.lg },
  spo2Row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  metricSub: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate },
  unit: { ...type.foot, marginTop: 4 },
  bars: { marginTop: 11, height: 22, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barCol: { flex: 1, borderRadius: 2 },
  trace: { marginTop: 11, height: 22, overflow: 'hidden' },
  glucoseTrack: { marginTop: 11, height: 22, justifyContent: 'center' },
  glucoseFill: { height: 5, borderRadius: radius.pill, backgroundColor: colors.brand, opacity: 0.85 },

  reminderCard: { paddingHorizontal: spacing.xl, paddingVertical: 5, borderRadius: radius.lg },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  reminderName: { fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink },
  reminderState: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.6 },

  quick: { width: '48%', flexGrow: 1, padding: spacing.xl, borderRadius: radius.lg },

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
