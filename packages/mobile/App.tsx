/**
 * Root component and screen routing.
 *
 * NAVIGATION CHOICE - a deliberate deviation from the plan, which said
 * expo-router. The flow is four screens with a strictly linear emergency path
 * (Home -> Emergency -> Tracking), and the Android hardware back button is
 * something this app wants to CONTROL rather than delegate: silently popping
 * out of an active dispatch would be wrong. A plain discriminated union of
 * screen states gives exactly that control, adds no dependency, and removes a
 * whole class of setup risk from a monorepo Metro configuration that was
 * already the main unknown. If deep linking or a tab bar is ever needed,
 * swapping in expo-router touches only this file.
 */

import { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import type { CaseId, Language } from '@triage/shared';
import { CompanionScreen } from './src/screens/CompanionScreen';
import { EmergencyCardScreen } from './src/screens/EmergencyCardScreen';
import { EmergencyScreen } from './src/screens/EmergencyScreen';
import { HandoffScreen } from './src/screens/HandoffScreen';
import { LanguageScreen } from './src/screens/LanguageScreen';
import { PhotoInjuryScreen } from './src/screens/PhotoInjuryScreen';
import { EmergencyQrScreen } from './src/screens/EmergencyQrScreen';
import { MedicineScannerScreen } from './src/screens/MedicineScannerScreen';
import { SilentDistressScreen } from './src/screens/SilentDistressScreen';
import { CountdownAlarm } from './src/components/CountdownAlarm';
import { startFallDetection } from './src/sensors/fallSensor';
import { FirstAidScreen } from './src/screens/FirstAidScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { TrackingScreen } from './src/screens/TrackingScreen';
import { ensureSignedIn, isFirebaseConfigured } from './src/firebase/client';
import { hydrateFirstAidCache } from './src/offline/firstAidStore';
import { colors } from './src/theme';

type Screen =
  | { readonly name: 'home' }
  | { readonly name: 'emergency' }
  | { readonly name: 'tracking'; readonly caseId: CaseId }
  | { readonly name: 'firstAid' }
  // The five rough screens. Companion and Handoff both need a live case, so
  // they carry the caseId in the state rather than reading a global - the
  // union makes it impossible to route to them without one.
  | { readonly name: 'emergencyCard' }
  | { readonly name: 'language' }
  | { readonly name: 'companion'; readonly caseId: CaseId }
  | { readonly name: 'handoff'; readonly caseId: CaseId }
  | { readonly name: 'photo' }
  | { readonly name: 'qr' }
  | { readonly name: 'medicine' }
  | { readonly name: 'silent' };

/**
 * Seconds to cancel an AUTOMATIC alert before contacts are notified.
 *
 * Long enough to fish the phone out of a pocket and read the screen; short
 * enough that a real fall is not left waiting. Nothing here dispatches an
 * ambulance - that still requires the 3-second press-and-hold gate.
 */
const AUTO_ALERT_COUNTDOWN_SECONDS = 30;

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // Language is app-level, not per-screen: changing it must not restart a case.
  const [language, setLanguage] = useState<Language>('en');
  /**
   * An automatic trigger (a detected fall today, Guardian Mode next) shows the
   * countdown OVER whatever screen is open, rather than navigating. Navigating
   * would lose whatever the user was doing, and the alert may well be wrong.
   */
  const [autoAlert, setAutoAlert] = useState<{ title: string; reason: string } | undefined>(
    undefined,
  );

  useEffect(() => {
    // Cache first-aid content before it is ever needed - the one thing that
    // must work when nothing else does.
    void hydrateFirstAidCache();

    // Anonymous sign-in populates request.auth for the Firestore rules. It
    // resolves false rather than throwing when it fails, so a misconfigured
    // Firebase project degrades the live-update feature instead of blocking
    // the whole app at launch.
    if (isFirebaseConfigured()) void ensureSignedIn();

    // Fall detection runs for the life of the app. It never dispatches - it
    // can only raise the cancellable countdown below.
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      {screen.name === 'home' ? (
        <HomeScreen
          onStartEmergency={() => setScreen({ name: 'emergency' })}
          onOpenFirstAid={() => setScreen({ name: 'firstAid' })}
          onOpenEmergencyCard={() => setScreen({ name: 'emergencyCard' })}
          onOpenLanguage={() => setScreen({ name: 'language' })}
          onOpenQr={() => setScreen({ name: 'qr' })}
          onOpenMedicine={() => setScreen({ name: 'medicine' })}
          onOpenSilent={() => setScreen({ name: 'silent' })}
        />
      ) : null}

      {screen.name === 'emergency' ? (
        <EmergencyScreen
          onDispatched={(caseId) => setScreen({ name: 'tracking', caseId })}
          onBack={() => setScreen({ name: 'home' })}
        />
      ) : null}

      {screen.name === 'tracking' ? (
        <TrackingScreen
          caseId={screen.caseId}
          onCancelled={() => setScreen({ name: 'home' })}
          onOpenCompanion={() => setScreen({ name: 'companion', caseId: screen.caseId })}
          onOpenHandoff={() => setScreen({ name: 'handoff', caseId: screen.caseId })}
        />
      ) : null}

      {screen.name === 'firstAid' ? (
        <FirstAidScreen onBack={() => setScreen({ name: 'home' })} />
      ) : null}

      {screen.name === 'emergencyCard' ? (
        <EmergencyCardScreen onBack={() => setScreen({ name: 'home' })} />
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
          onBack={() => setScreen({ name: 'home' })}
        />
      ) : null}

      {screen.name === 'handoff' ? (
        <HandoffScreen caseId={screen.caseId} onBack={() => setScreen({ name: 'home' })} />
      ) : null}

      {screen.name === 'photo' ? (
        <PhotoInjuryScreen onBack={() => setScreen({ name: 'emergency' })} />
      ) : null}

      {screen.name === 'qr' ? (
        <EmergencyQrScreen onBack={() => setScreen({ name: 'home' })} />
      ) : null}

      {screen.name === 'medicine' ? (
        <MedicineScannerScreen onBack={() => setScreen({ name: 'home' })} />
      ) : null}

      {screen.name === 'silent' ? (
        <SilentDistressScreen
          onSharePing={() => {
            // Deliberately silent: no toast, no log the user can see. The
            // adversary in this mode is standing next to them.
          }}
          onExit={() => setScreen({ name: 'home' })}
        />
      ) : null}

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
  root: { flex: 1, backgroundColor: colors.bg },
});
