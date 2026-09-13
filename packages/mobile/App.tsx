/**
 * Root component, font loading and screen routing.
 *
 * NAVIGATION CHOICE — still a plain discriminated union rather than
 * expo-router. The emergency path is strictly linear and the Android hardware
 * back button is something this app wants to CONTROL rather than delegate:
 * silently popping out of an active dispatch would be wrong. A union of screen
 * states gives exactly that, adds no dependency, and keeps a tricky monorepo
 * Metro setup simple. The design's twelve screens fit it unchanged.
 *
 * ---------------------------------------------------------------------------
 * FONTS BLOCK NOTHING.
 *
 * `useFonts` resolves asynchronously and the app renders either way. The design
 * depends heavily on Plus Jakarta Sans, IBM Plex Mono and Instrument Serif, but
 * a splash screen held until three webfonts download is indefensible in an app
 * whose first screen may be opened during an emergency. Until they land the
 * system face is used; when they land the tree re-renders. The only visible
 * effect is a brief reflow.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
// `SafeAreaView` from `react-native` itself is a no-op on Android — it only
// applies inset padding on iOS, which is exactly why "Vitalis" sat flush
// under the status bar on a real Android device while looking fine on an iOS
// simulator. `react-native-safe-area-context`'s version measures real device
// insets on both platforms. `SafeAreaProvider` has to wrap the whole tree
// once, at the root, for `SafeAreaView` (and any future `useSafeAreaInsets`)
// to have anything to read.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import type { CaseId, Language } from '@triage/shared';

import { AssistantScreen } from './src/screens/AssistantScreen';
import { CancelledScreen } from './src/screens/CancelledScreen';
import { CompanionScreen } from './src/screens/CompanionScreen';
import { EmergencyCardScreen } from './src/screens/EmergencyCardScreen';
import { EmergencyScreen } from './src/screens/EmergencyScreen';
import { EscalatedScreen } from './src/screens/EscalatedScreen';
import { FirstAidScreen } from './src/screens/FirstAidScreen';
import { HandoffScreen } from './src/screens/HandoffScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LanguageScreen } from './src/screens/LanguageScreen';
import { MedicineScannerScreen } from './src/screens/MedicineScannerScreen';
import { PhotoInjuryScreen } from './src/screens/PhotoInjuryScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { TrackingScreen } from './src/screens/TrackingScreen';

import { CountdownAlarm } from './src/components/CountdownAlarm';
import { Screen, type Tab } from './src/ui/Chrome';
import { startFallDetection } from './src/sensors/fallSensor';
import { hydrateFirstAidCache } from './src/offline/firstAidStore';
import { ensureSignedIn, isFirebaseConfigured } from './src/firebase/client';
import { api } from './src/api/client';
import { AssistantChatProvider } from './src/state/assistantChat';

/**
 * The assistant's first message. Lives here, not in AssistantScreen, because
 * the provider that owns the conversation now lives here too — see
 * `state/assistantChat.tsx` for why the chat had to move above the screen
 * switch in the first place.
 */
const ASSISTANT_OPENING = {
  id: 'opening',
  who: 'agent' as const,
  text: 'Ask me anything about your health, your readings, or your medication. If what you describe sounds urgent I will stop and move you to the triage interview instead — that is deliberate.',
};

type ScreenState =
  | { readonly name: 'home' }
  | { readonly name: 'assistant' }
  | { readonly name: 'emergency'; readonly openCaseId?: CaseId }
  | { readonly name: 'tracking'; readonly caseId: CaseId }
  | { readonly name: 'firstAid' }
  | { readonly name: 'emergencyCard' }
  | { readonly name: 'language' }
  | { readonly name: 'companion'; readonly caseId: CaseId }
  | { readonly name: 'handoff'; readonly caseId: CaseId }
  | { readonly name: 'photo'; readonly caseId?: CaseId }
  | { readonly name: 'escalated'; readonly caseId: CaseId }
  | { readonly name: 'cancelled' }
  | { readonly name: 'medicine' }
  | { readonly name: 'profile' };

/**
 * Seconds to cancel an AUTOMATIC alert before it escalates.
 *
 * Long enough to fish the phone out of a pocket and read the screen; short
 * enough that a real fall is not left waiting. Nothing here dispatches an
 * ambulance — that still requires the 3-second press-and-hold gate.
 */
const AUTO_ALERT_COUNTDOWN_SECONDS = 30;

/**
 * The actual root export, kept to a one-liner: wrap the whole screen switch in
 * the assistant chat provider so navigating to and from the Assistant tab
 * stops wiping the conversation, then render everything else unchanged.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AssistantChatProvider opening={ASSISTANT_OPENING}>
        <AppShell />
      </AssistantChatProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const [screen, setScreen] = useState<ScreenState>({ name: 'home' });
  // App-level, not per-screen: changing it must never restart a case.
  const [language, setLanguage] = useState<Language>('en');
  const [autoAlert, setAutoAlert] = useState<{ title: string; reason: string } | undefined>(
    undefined,
  );

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
    InstrumentSerif_400Regular,
  });
  // Referenced so the dependency is explicit rather than incidental; the value
  // itself is deliberately not gating render. See the file header.
  void fontsLoaded;

  useEffect(() => {
    void hydrateFirstAidCache();
    if (isFirebaseConfigured()) void ensureSignedIn();

    let stop: (() => void) | undefined;
    void startFallDetection((event) => {
      setAutoAlert({
        title: 'Possible fall detected',
        reason: `A sharp impact (${event.impactG.toFixed(1)}g) followed by no movement.`,
      });
    }).then((fn) => {
      stop = fn;
    });
    return () => stop?.();
  }, []);

  const goTab = (tab: Exclude<Tab, 'none'>) => {
    if (tab === 'home') setScreen({ name: 'home' });
    if (tab === 'assistant') setScreen({ name: 'assistant' });
    if (tab === 'emergency') setScreen({ name: 'emergency' });
    if (tab === 'firstaid') setScreen({ name: 'firstAid' });
  };

  /** Which tab lights up. Sub-screens keep their parent tab lit. */
  const activeTab: Tab =
    screen.name === 'home'
      ? 'home'
      : screen.name === 'assistant'
        ? 'assistant'
        : screen.name === 'firstAid'
          ? 'firstaid'
          : screen.name === 'emergency' ||
              screen.name === 'photo' ||
              screen.name === 'escalated' ||
              screen.name === 'cancelled'
            ? 'emergency'
            : 'none';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#eef3fa" />

      <Screen
        tab={activeTab}
        onTab={goTab}
        // Tracking owns the screen: the pinned Cancel Alert must not compete
        // with a tab bar while an alert is live.
        hideNav={screen.name === 'tracking'}
        scroll={screen.name !== 'assistant'}
      >
        {screen.name === 'home' ? (
          <HomeScreen
            onStartEmergency={() => setScreen({ name: 'emergency' })}
            onOpenFirstAid={() => setScreen({ name: 'firstAid' })}
            onOpenEmergencyCard={() => setScreen({ name: 'emergencyCard' })}
            onOpenLanguage={() => setScreen({ name: 'language' })}
            onOpenMedicine={() => setScreen({ name: 'medicine' })}
            onOpenProfile={() => setScreen({ name: 'profile' })}
          />
        ) : null}

        {screen.name === 'assistant' ? (
          <AssistantScreen
            onOpenFullCase={(caseId) => setScreen({ name: 'emergency', openCaseId: caseId })}
          />
        ) : null}

        {screen.name === 'emergency' ? (
          <EmergencyScreen
            onDispatched={(caseId) => setScreen({ name: 'tracking', caseId })}
            onEscalated={(caseId) => setScreen({ name: 'escalated', caseId })}
            onPhoto={(caseId) => setScreen({ name: 'photo', caseId })}
            onBack={() => setScreen({ name: 'home' })}
            {...(screen.openCaseId === undefined ? {} : { openCaseId: screen.openCaseId })}
          />
        ) : null}

        {screen.name === 'tracking' ? (
          <TrackingScreen
            caseId={screen.caseId}
            onCancelled={() => setScreen({ name: 'cancelled' })}
            onOpenCompanion={() => setScreen({ name: 'companion', caseId: screen.caseId })}
            onOpenHandoff={() => setScreen({ name: 'handoff', caseId: screen.caseId })}
          />
        ) : null}

        {screen.name === 'escalated' ? (
          <EscalatedScreen
            caseId={screen.caseId}
            onBack={() => setScreen({ name: 'emergency' })}
            onRequestAmbulance={() => setScreen({ name: 'emergency' })}
          />
        ) : null}

        {screen.name === 'cancelled' ? (
          <CancelledScreen
            onReopen={() => setScreen({ name: 'emergency' })}
            onHome={() => setScreen({ name: 'home' })}
          />
        ) : null}

        {screen.name === 'firstAid' ? (
          <FirstAidScreen onBack={() => setScreen({ name: 'home' })} />
        ) : null}

        {screen.name === 'emergencyCard' ? (
          <EmergencyCardScreen
            onBack={() => setScreen({ name: 'home' })}
            onOpenProfile={() => setScreen({ name: 'profile' })}
          />
        ) : null}

        {screen.name === 'profile' ? (
          <ProfileScreen onBack={() => setScreen({ name: 'home' })} />
        ) : null}

        {screen.name === 'language' ? (
          <LanguageScreen
            current={language}
            onSelect={(next) => {
              setLanguage(next);
              setScreen({ name: 'home' });
            }}
            onBack={() => setScreen({ name: 'home' })}
          />
        ) : null}

        {screen.name === 'companion' ? (
          <CompanionScreen
            caseId={screen.caseId}
            onOpenFirstAid={() => setScreen({ name: 'firstAid' })}
            onBack={() => setScreen({ name: 'tracking', caseId: screen.caseId })}
          />
        ) : null}

        {screen.name === 'handoff' ? (
          <HandoffScreen
            caseId={screen.caseId}
            onBack={() => setScreen({ name: 'tracking', caseId: screen.caseId })}
          />
        ) : null}

        {screen.name === 'photo' ? (
          <PhotoInjuryScreen
            onBack={() => setScreen({ name: 'emergency' })}
            {...(screen.caseId === undefined
              ? {}
              : {
                  onSubmit: async (photoRef: string) => {
                    await api.submitPhoto(screen.caseId as CaseId, photoRef);
                  },
                })}
          />
        ) : null}

        {screen.name === 'medicine' ? (
          <MedicineScannerScreen onBack={() => setScreen({ name: 'home' })} />
        ) : null}

      </Screen>

      {/* Rendered last so it covers whatever is beneath it. */}
      {autoAlert !== undefined ? (
        <CountdownAlarm
          title={autoAlert.title}
          reason={autoAlert.reason}
          seconds={AUTO_ALERT_COUNTDOWN_SECONDS}
          onCancel={() => setAutoAlert(undefined)}
          onElapsed={() => {
            setAutoAlert(undefined);
            setScreen({ name: 'emergency' });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef3fa' },
});
