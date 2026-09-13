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
import { colors, fonts, radius, spacing, type } from '../theme';
import { Label } from '../ui/primitives';

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
    /**
     * The coordinates-only fallback, styled as the design's MAP UNAVAILABLE
     * card.
     *
     * react-native-maps renders blank in Expo Go on recent SDKs, so this is the
     * path the demo will most likely take — which is why it is a designed
     * surface rather than an apology. It says plainly that nothing about the
     * dispatch depends on the map, because a blank rectangle where a map should
     * be reads as the whole screen having failed.
     */
    return (
      <View style={styles.fallback}>
        <Label>
          {centre === undefined ? 'WAITING FOR LOCATION' : 'MAP UNAVAILABLE · COORDINATES ONLY'}
        </Label>
        {destination !== undefined ? (
          <Text style={styles.fallbackName}>{destination.name}</Text>
        ) : null}
        {centre !== undefined ? (
          <Text style={styles.coords}>
            {destination === undefined
              ? `You: ${centre.lat.toFixed(4)}° N, ${centre.lng.toFixed(4)}° E`
              : `${destination.lat.toFixed(4)}° N, ${destination.lng.toFixed(4)}° E`}
          </Text>
        ) : null}
        {origin !== undefined && destination !== undefined ? (
          <Text style={styles.coords}>
            {`You: ${origin.lat.toFixed(4)}° N, ${origin.lng.toFixed(4)}° E`}
          </Text>
        ) : null}
        <Text style={styles.fallbackNote}>
          {centre === undefined
            ? 'Location has not been shared, so no hospital can be matched. Everything else on this screen still works.'
            : 'The map view failed to load. ETA, destination and Cancel Alert all still work — nothing about the dispatch depends on the map.'}
        </Text>
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
            pinColor={colors.brand}
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
    height: 186,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#e4ecf7',
  },
  fallback: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(29,78,216,0.35)',
    backgroundColor: colors.surfaceSoft,
    padding: 18,
    gap: 6,
  },
  fallbackName: { fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink, marginTop: 4 },
  coords: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 20, color: colors.inkSoft },
  fallbackNote: { ...type.foot, marginTop: 2 },
});
