/**
 * Offline first-aid (spec 5.8). Explicitly separate from the live agentic
 * loop: no tool calls, no network, no risk scoring. It reads from the on-device
 * cache and works with the radio off.
 */

import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  EMERGENCY_NUMBER,
  FIRST_AID_DISCLAIMER,
  type FirstAidTopic,
} from '../data/firstAidContent';
import { loadFirstAidTopics } from '../offline/firstAidStore';
import { colors, radius, spacing, type } from '../theme';

export function FirstAidScreen({ onBack }: { readonly onBack: () => void }) {
  const [topics, setTopics] = useState<readonly FirstAidTopic[]>([]);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void loadFirstAidTopics().then((t) => {
      if (!cancelled) setTopics(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>First aid</Text>
      <Text style={type.small}>Stored on this device, works with no signal.</Text>

      <Pressable
        style={styles.callButton}
        onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
      >
        <Text style={styles.callText}>Call {EMERGENCY_NUMBER}</Text>
      </Pressable>

      {topics.map((topic) => {
        const open = openId === topic.id;
        return (
          <View key={topic.id} style={styles.card}>
            <Pressable onPress={() => setOpenId(open ? undefined : topic.id)}>
              <Text style={type.h3}>{topic.title}</Text>
              <Text style={type.small}>{topic.whenToUse}</Text>
            </Pressable>

            {open ? (
              <View style={styles.steps}>
                {topic.callEmergencyFirst ? (
                  <Text style={styles.callFirst}>Call {EMERGENCY_NUMBER} first.</Text>
                ) : null}
                {topic.steps.map((step) => (
                  <View key={step.n} style={styles.stepRow}>
                    <Text style={styles.stepNum}>{step.n}</Text>
                    <Text style={styles.stepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.disclaimer}>{FIRST_AID_DISCLAIMER}</Text>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  steps: { marginTop: spacing.md, gap: spacing.sm },
  callFirst: { ...type.h3, color: colors.danger, marginBottom: spacing.xs },
  stepRow: { flexDirection: 'row', gap: spacing.md },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.bg,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '700',
    color: colors.text,
    fontSize: 13,
  },
  stepText: { flex: 1, ...type.body, lineHeight: 21 },
  callButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  callText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  disclaimer: { ...type.tiny, lineHeight: 16, marginTop: spacing.sm },
  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
