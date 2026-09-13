/**
 * Health home — the design's `isHome` screen.
 *
 * Redesigned to match the reference UI: iOS-inspired glassmorphism with
 * white/light-blue palette, frosted glass cards, emergency button,
 * vitals/medication panels, feature grid, and language card.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Ellipse, Rect } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../api/client';
import { VitalsPanel } from '../components/VitalsPanel';
import { MedicationsPanel } from '../components/MedicationsPanel';
import { FadeUp } from '../ui/motion';
import { colors, fonts, radius, spacing } from '../theme';

interface Props {
  readonly onStartEmergency: () => void;
  readonly onOpenFirstAid: () => void;
  readonly onOpenEmergencyCard: () => void;
  readonly onOpenLanguage: () => void;
  readonly onOpenMedicine: () => void;
  readonly onOpenProfile: () => void;
}

// Design tokens matching the reference
const D = {
  text: '#142744',
  muted: '#7185A3',
  primary: '#1769E8',
  red: '#FF3B3B',
  glass: 'rgba(255,255,255,0.68)',
  glassStrong: 'rgba(255,255,255,0.78)',
  glassBorder: 'rgba(255,255,255,0.88)',
  glassBlue: 'rgba(205,225,255,0.32)',
} as const;

export function HomeScreen({
  onStartEmergency,
  onOpenFirstAid,
  onOpenEmergencyCard,
  onOpenLanguage,
  onOpenMedicine,
  onOpenProfile,
}: Props) {
  return (
    <View style={styles.root}>
      {/* Emergency button */}
      <FadeUp delayMs={0}>
        <EmergencyButton onPress={onStartEmergency} />
      </FadeUp>

      {/* Vitals card */}
      <FadeUp delayMs={60}>
        <VitalsCard />
      </FadeUp>

      {/* Medication reminders card */}
      <FadeUp delayMs={120}>
        <MedicationsCard />
      </FadeUp>

      {/* Feature grid — 2 columns */}
      <FadeUp delayMs={180}>
        <View style={styles.grid}>
          <FeatureTile
            icon={<BloodDropIcon />}
            iconBg="rgba(255,100,100,0.12)"
            title="Emergency card"
            sub="Blood group, allergies, contacts"
            onPress={onOpenEmergencyCard}
          />
          <FeatureTile
            icon={<PersonIcon />}
            iconBg="rgba(23,105,232,0.12)"
            title="Profile"
            sub="Your details and emergency contacts"
            onPress={onOpenProfile}
          />
          <FeatureTile
            icon={<CapsuleIcon />}
            iconBg="rgba(255,180,50,0.14)"
            title="Medicine scanner"
            sub="Expiry, dose, what it is"
            onPress={onOpenMedicine}
          />
          <FeatureTile
            icon={<BandageIcon />}
            iconBg="rgba(200,175,130,0.18)"
            title="First aid"
            sub="Works with no signal"
            onPress={onOpenFirstAid}
          />
        </View>
      </FadeUp>

      {/* Language card */}
      <FadeUp delayMs={240}>
        <LanguageCard onPress={onOpenLanguage} />
      </FadeUp>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Emergency button
// ---------------------------------------------------------------------------

function EmergencyButton({ onPress }: { readonly onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={styles.emergencyOuter}>
        <BlurView intensity={30} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['rgba(255,82,82,0.22)', 'rgba(255,255,255,0.10)', 'rgba(190,220,255,0.30)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.emergencyContent}>
          {/* Red circle phone icon */}
          <View style={styles.emergencyIconWrap}>
            <BlurView intensity={20} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.emergencyIconBg} />
            <PhoneIcon />
          </View>
          <Text style={styles.emergencyLabel}>Start emergency</Text>
          {/* Settings gear button */}
          <View style={styles.settingsWrap}>
            <BlurView intensity={18} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.settingsBg} />
            <GearIcon />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Vitals card wrapper
// ---------------------------------------------------------------------------

function VitalsCard() {
  return (
    <View style={styles.glassCard}>
      <BlurView intensity={28} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.glassCardTint]} />
      {/* Heartbeat watermark */}
      <View style={styles.watermarkWrap} pointerEvents="none">
        <HeartbeatIcon />
      </View>
      <VitalsPanel />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Medications card wrapper
// ---------------------------------------------------------------------------

function MedicationsCard() {
  return (
    <View style={styles.glassCard}>
      <BlurView intensity={28} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.glassCardTint]} />
      {/* Bell watermark */}
      <View style={styles.watermarkWrapBell} pointerEvents="none">
        <BellIcon />
      </View>
      <MedicationsPanel />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feature tile
// ---------------------------------------------------------------------------

function FeatureTile({
  icon,
  iconBg,
  title,
  sub,
  onPress,
}: {
  readonly icon: React.ReactNode;
  readonly iconBg: string;
  readonly title: string;
  readonly sub: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tilePressable, pressed && { transform: [{ scale: 0.96 }] }]}
    >
      <View style={styles.tileOuter}>
        <BlurView intensity={25} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['rgba(255,255,255,0.78)', 'rgba(225,238,255,0.48)']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Arrow button top-right */}
        <View style={styles.tileArrow}>
          <BlurView intensity={15} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={styles.tileArrowBg} />
          <ChevronRightSmall />
        </View>
        <View style={styles.tileContent}>
          {/* Icon circle */}
          <View style={[styles.tileIconWrap, { backgroundColor: iconBg }]}>
            {icon}
          </View>
          <Text style={styles.tileTitle}>{title}</Text>
          <Text style={styles.tileSub}>{sub}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Language card
// ---------------------------------------------------------------------------

function LanguageCard({ onPress }: { readonly onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={styles.langOuter}>
        <BlurView intensity={28} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.glassCardTint]} />
        <View style={styles.langContent}>
          {/* Globe icon */}
          <View style={styles.langIconWrap}>
            <BlurView intensity={18} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.langIconBg} />
            <GlobeIcon />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.langTitle}>Language</Text>
            <Text style={styles.langSub}>{'English · हिन्दी · తెలుగు · தமிழ்'}</Text>
          </View>
          {/* Arrow right */}
          <View style={styles.langArrow}>
            <BlurView intensity={15} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.tileArrowBg} />
            <ChevronRight />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

function PhoneIcon() {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"
        fill="white"
      />
    </Svg>
  );
}

function GearIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke="#7185A3"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="#7185A3"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BloodDropIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"
        fill="#FF5252"
        stroke="#FF5252"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PersonIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} fill="#1769E8" />
      <Path
        d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
        stroke="#1769E8"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CapsuleIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={10} width={18} height={4} rx={2} fill="#F5A623" transform="rotate(-45 12 12)" />
      <Path
        d="M7.76 7.76L16.24 16.24"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Path
        d="M17 7a5 5 0 010 10H7a5 5 0 010-10h10z"
        stroke="#F5A623"
        strokeWidth={1.5}
        fill="none"
        transform="rotate(-45 12 12)"
      />
    </Svg>
  );
}

function BandageIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={9} width={18} height={6} rx={3} fill="#C8A880" transform="rotate(-30 12 12)" />
      <Rect x={3} y={9} width={18} height={6} rx={3} stroke="#B8976A" strokeWidth={1} fill="none" transform="rotate(-30 12 12)" />
      <Circle cx={12} cy={12} r={1.5} fill="white" />
    </Svg>
  );
}

function GlobeIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke="#1769E8" strokeWidth={1.8} />
      <Path
        d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"
        stroke="#1769E8"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronRightSmall() {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18l6-6-6-6" stroke="#7185A3" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronRight() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18l6-6-6-6" stroke="#7185A3" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function HeartbeatIcon() {
  return (
    <Svg width={80} height={50} viewBox="0 0 80 50" fill="none" opacity={0.13}>
      <Path
        d="M0 25h15l8-18 10 36 8-25 6 14h33"
        stroke="#1769E8"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BellIcon() {
  return (
    <Svg width={60} height={60} viewBox="0 0 24 24" fill="none" opacity={0.13}>
      <Path
        d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
        stroke="#1769E8"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CARD_RADIUS = 22;
const ICON_CIRCLE = 52;

const styles = StyleSheet.create({
  root: { gap: 16 },

  // Emergency button
  emergencyOuter: {
    height: 90,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.90)',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#102a54',
    shadowOpacity: 0.13,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
  },
  emergencyContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 14,
  },
  emergencyIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  emergencyIconBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FF3B3B',
    borderRadius: 29,
  },
  emergencyLabel: {
    flex: 1,
    fontFamily: fonts.sansBold,
    fontSize: 17,
    color: '#142744',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  settingsWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  settingsBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 20,
  },

  // Glass card (vitals / medications)
  glassCard: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    overflow: 'hidden',
    padding: 18,
    elevation: 4,
    shadowColor: '#102a54',
    shadowOpacity: 0.09,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 8 },
  },
  glassCardTint: {
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  watermarkWrap: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    opacity: 1,
  },
  watermarkWrapBell: {
    position: 'absolute',
    right: 12,
    bottom: 8,
    opacity: 1,
  },

  // Feature grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tilePressable: {
    width: '48%',
    flexGrow: 1,
    minHeight: 140,
  },
  tileOuter: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#102a54',
    shadowOpacity: 0.10,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
  },
  tileArrow: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    zIndex: 1,
  },
  tileArrowBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  tileContent: {
    flex: 1,
    padding: 18,
    paddingTop: 14,
    gap: 0,
  },
  tileIconWrap: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.60)',
  },
  tileTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    color: '#142744',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  tileSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: '#7185A3',
    lineHeight: 16,
  },

  // Language card
  langOuter: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#102a54',
    shadowOpacity: 0.09,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  langContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
  },
  langIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  langIconBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23,105,232,0.10)',
  },
  langTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    color: '#142744',
    letterSpacing: -0.2,
  },
  langSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: '#7185A3',
    marginTop: 2,
  },
  langArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
});
