/**
 * Map for the live-tracking screen.
 *
 * `react-native-maps` is loaded lazily via require() inside a try/catch rather
 * than a static import, and this is deliberate. The library has a documented
 * history of rendering blank or failing to link in Expo Go on some SDK
 * versions; a static import would take the whole screen down with it. Since the
 * map is presentation and every judged behaviour (ETA, destination, cancel)
 * lives elsewhere, a failure here degrades to a coordinate card instead.
 *
 * On Android in Expo Go this uses Expo's bundled Google Maps key, so no API key
 * of our own is needed - which matters given the free-tier-only constraint. A
 * standalone Android build would require a real Google Maps key in app.json.
 */

import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

interface Props {
  readonly destination?: (LatLng & { readonly name: string }) | undefined;
  readonly origin?: LatLng | undefined;
}

// Resolved once at module load. `undefined` means the map is unavailable and
// the fallback renders instead.
const Maps = loadMaps();

function loadMaps():
  | {
      MapView: React.ComponentType<Record<string, unknown>>;
      Marker: React.ComponentType<Record<string, unknown>>;
    }
  | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-maps') as {
      default: React.ComponentType<Record<string, unknown>>;
      Marker: React.ComponentType<Record<string, unknown>>;
    };
    return { MapView: mod.default, Marker: mod.Marker };
  } catch {
    return undefined;
  }
}

export function MapPanel({ destination, origin }: Props) {
  const centre = destination ?? origin;

  if (Maps === undefined || centre === undefined) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>
          {centre === undefined ? 'Waiting for location' : 'Map unavailable'}
        </Text>
        {centre !== undefined ? (
          <Text style={type.mono}>
            {centre.lat.toFixed(4)}, {centre.lng.toFixed(4)}
          </Text>
        ) : null}
        {destination !== undefined ? (
          <Text style={[type.small, { marginTop: spacing.xs }]}>{destination.name}</Text>
        ) : null}
      </View>
    );
  }

  const { MapView, Marker } = Maps;

  return (
    <View style={styles.mapWrap}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: centre.lat,
          longitude: centre.lng,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        pointerEvents="none"
      >
        {origin !== undefined ? (
          <Marker
            coordinate={{ latitude: origin.lat, longitude: origin.lng }}
            title="You"
            pinColor={colors.primary}
          />
        ) : null}
        {destination !== undefined ? (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            title={destination.name}
            pinColor={colors.danger}
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    height: 220,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.border,
  },
  fallback: {
    height: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fallbackTitle: { ...type.h3, marginBottom: spacing.xs },
});
