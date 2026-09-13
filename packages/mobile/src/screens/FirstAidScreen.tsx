/**
 * Offline first aid — the design's `isFirstAid` screen.
 *
 * The design renders the guides as a 3D card stack with perspective: the
 * selected card front and centre, the others fanned behind it at a slight
 * rotation. React Native supports `perspective` and `rotateY` on a transform,
 * so the stack is reproduced rather than flattened into a list — it is the one
 * genuinely playful moment in the app and it earns its place by making four
 * guides browsable without scrolling past the one you need.
 *
 * ---------------------------------------------------------------------------
 * THIS SCREEN MUST WORK WITH NO NETWORK AND NO SERVER. That is spec §5.8 and
 * it is why the content is bundled into the JS rather than fetched. It is also
 * why this screen touches no API client, no Firestore listener and no auth —
 * anything it imported could fail, and the whole point is that it cannot.
 *
 * The emergency number appears above the guides, not below them: the first
 * instruction in three of the four guides is "call first", and a call-to-action
 * underneath a scroll is not an instruction anyone will follow.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  FIRST_AID_DISCLAIMER,
  FIRST_AID_TOPICS,
  type FirstAidTopic,
} from '../data/firstAidContent';
import { loadFirstAidTopics } from '../offline/firstAidStore';
import { BackLink, Label } from '../ui/primitives';
import { colors, dangerWash, fonts, radius, shadow, spacing, type } from '../theme';

/**
 * India's single emergency number.
 *
 * 112 replaced the separate 100/101/102 numbers nationally and routes to all
 * services, so it is the one number that is right regardless of what is
 * actually wrong — which matters when the person dialling may not know.
 */
const EMERGENCY_NUMBER = '112';

export function FirstAidScreen({ onBack }: { readonly onBack: () => void }) {
  const [topics, setTopics] = useState<readonly FirstAidTopic[]>(FIRST_AID_TOPICS);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // The cache may hold newer content than the bundle. If it fails for any
    // reason the bundled copy is already on screen, so nothing is handled here.
    void loadFirstAidTopics().then((cached) => {
      if (cached.length > 0) setTopics(cached);
    });
  }, []);

  const active = topics[index] ?? topics[0];

  return (
    <View style={styles.root}>
      <BackLink onPress={onBack} />

      <View style={styles.titleRow}>
        <Text style={type.h1}>First aid</Text>
        <View style={styles.offlineChip}>
          <Text style={styles.offlineText}>OFFLINE READY</Text>
        </View>
      </View>
      <Text style={[type.small, { marginTop: -6 }]}>
        Bundled into the app. No connection is needed to open any of these.
      </Text>

      <View style={styles.tabs}>
        {topics.map((topic, i) => (
          <Pressable
            key={topic.id}
            onPress={() => setIndex(i)}
            style={({ pressed }) => [
              styles.tab,
              i === index ? styles.tabOn : styles.tabOff,
              pressed ? { transform: [{ scale: 0.96 }] } : null,
            ]}
          >
            <Text style={[styles.tabLabel, { color: i === index ? colors.white : colors.inkSoft }]}>
              {topic.title}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}>
        <LinearGradient
          colors={dangerWash.colors}
          start={dangerWash.start}
          end={dangerWash.end}
          style={styles.callCard}
        >
          <View>
            <Label color="rgba(255,255,255,0.85)">CALL FIRST</Label>
            <Text style={styles.callNumber}>{EMERGENCY_NUMBER}</Text>
          </View>
          <Text style={styles.callBody}>
            {`Call ${EMERGENCY_NUMBER} now, or have someone else call while you start.`}
          </Text>
        </LinearGradient>
      </Pressable>

      {/* The card stack. Cards behind the active one are pushed back in Z,
          scaled down and rotated — the same values the design uses. */}
      <View style={styles.stack}>
        {topics.map((topic, i) => {
          const offset = i - index;
          const distance = Math.abs(offset);
          return (
            <Pressable
              key={topic.id}
              onPress={() => setIndex(i)}
              style={[
                styles.stackCard,
                {
                  zIndex: 10 - distance,
                  opacity: distance > 2 ? 0 : 1,
                  transform: [
                    { perspective: 900 },
                    { translateX: offset * 26 },
                    { translateY: distance * 10 },
                    { scale: 1 - distance * 0.08 },
                    { rotateY: `${offset * -8}deg` },
                  ],
                },
              ]}
            >
              <Text style={styles.cardTitle}>{topic.title}</Text>
              <Text style={[type.small, { marginTop: 4 }]}>{topic.whenToUse}</Text>
              <View style={styles.steps}>
                {topic.steps.map((step) => (
                  <View key={step.n} style={styles.step}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepNum}>{step.n}</Text>
                    </View>
                    <Text style={styles.stepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>Tap a card to bring it forward.</Text>
      <Text style={styles.disclaimer}>{FIRST_AID_DISCLAIMER}</Text>
      {active?.callEmergencyFirst === true ? (
        <Text style={styles.callFirstNote}>
          {`For ${active.title.toLowerCase()}, calling ${EMERGENCY_NUMBER} comes before anything else on this card.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  offlineChip: {
    backgroundColor: colors.okWash,
    borderWidth: 1,
    borderColor: 'rgba(21,128,61,0.3)',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  offlineText: { fontFamily: fonts.monoBold, fontSize: 9.5, color: colors.ok, letterSpacing: 0.6 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tab: { borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 15, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brand, borderColor: 'rgba(255,255,255,0.4)' },
  tabOff: { backgroundColor: 'rgba(255,255,255,0.7)', borderColor: colors.hairline },
  tabLabel: { fontFamily: fonts.sansSemi, fontSize: 12 },
  callCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    ...shadow('lift'),
  },
  callNumber: { fontFamily: fonts.sansBlack, fontSize: 22, color: colors.white, marginTop: 8 },
  callBody: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11.5,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.9)',
  },
  stack: { height: 300, marginTop: 4 },
  stackCard: {
    position: 'absolute',
    left: '6%',
    top: 0,
    width: '88%',
    backgroundColor: 'rgba(232,241,255,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.lg,
    padding: 17,
    ...shadow('lift'),
  },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 17, color: colors.ink },
  steps: { marginTop: 14, gap: 11 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(29,78,216,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(29,78,216,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: { fontFamily: fonts.monoBold, fontSize: 11, color: colors.brand },
  stepText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.ink,
    paddingTop: 2,
  },
  hint: { ...type.foot, textAlign: 'center' },
  disclaimer: { ...type.foot, textAlign: 'center' },
  callFirstNote: { ...type.foot, textAlign: 'center', color: colors.dangerDeep },
});
