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
import type { CaseId } from '@triage/shared';
import { EmergencyScreen } from './src/screens/EmergencyScreen';
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
  | { readonly name: 'firstAid' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    // Cache first-aid content before it is ever needed - the one thing that
    // must work when nothing else does.
    void hydrateFirstAidCache();

    // Anonymous sign-in populates request.auth for the Firestore rules. It
    // resolves false rather than throwing when it fails, so a misconfigured
    // Firebase project degrades the live-update feature instead of blocking
    // the whole app at launch.
    if (isFirebaseConfigured()) void ensureSignedIn();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      {screen.name === 'home' ? (
        <HomeScreen
          onStartEmergency={() => setScreen({ name: 'emergency' })}
          onOpenFirstAid={() => setScreen({ name: 'firstAid' })}
        />
      ) : null}

      {screen.name === 'emergency' ? (
        <EmergencyScreen
          onDispatched={(caseId) => setScreen({ name: 'tracking', caseId })}
          onBack={() => setScreen({ name: 'home' })}
        />
      ) : null}

      {screen.name === 'tracking' ? (
        <TrackingScreen caseId={screen.caseId} onCancelled={() => setScreen({ name: 'home' })} />
      ) : null}

      {screen.name === 'firstAid' ? (
        <FirstAidScreen onBack={() => setScreen({ name: 'home' })} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
