/**
 * Nearby hospitals, shown inline on the Emergency screen (5.3 UI).
 *
 * Calls the new `GET /hospitals/nearby` route, which is a thin pass-through
 * to the existing OSM hospital matching — no new backend logic, just the
 * client-facing endpoint that did not exist before.
 *
 * NO HOSPITAL PHOTOS: no free, keyless API publishes hospital building
 * photos, and inventing a stock image next to a real hospital's real phone
 * number would be exactly the kind of dishonest blend
 * `osm-hospital-port.ts`'s header warns against. Name, address, and a real
 * call button are shown; nothing is pictured.
 */

import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Hospital } from '@triage/shared';
import { api } from '../api/client';
import { Glass, Label } from '../ui/primitives';
import { colors, fonts, radius, spacing, type } from '../theme';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly hospitals: readonly Hospital[] }
  | { readonly kind: 'unavailable'; readonly message: string };

export function HospitalsPanel() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });

    (async () => {
      try {
        // Required lazily, same as reportLocation.ts - a device without the
        // module must not take the whole screen down at import time.
        const Location = await import('expo-location');
        const { status: permission } = await Location.requestForegroundPermissionsAsync();
        if (permission !== 'granted') {
          if (!cancelled) {
            setStatus({ kind: 'unavailable', message: 'Location permission needed to find nearby hospitals.' });
          }
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const result = await api.nearbyHospitals(position.coords.latitude, position.coords.longitude);
        if (!cancelled) setStatus({ kind: 'done', hospitals: result.hospitals });
      } catch {
        if (!cancelled) setStatus({ kind: 'unavailable', message: 'Could not look up nearby hospitals right now.' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === 'idle' || status.kind === 'loading') return null;

  return (
    <Glass tone="plain" contentStyle={styles.card}>
      <Label>NEARBY HOSPITALS</Label>
      {status.kind === 'unavailable' ? (
        <Text style={[type.small, { marginTop: 8 }]}>{status.message}</Text>
      ) : status.hospitals.length === 0 ? (
        <Text style={[type.small, { marginTop: 8 }]}>No hospitals found nearby.</Text>
      ) : (
        status.hospitals.map((hospital, i) => (
          <View key={hospital.osmId} style={[styles.row, i > 0 ? styles.rowDivider : null]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{hospital.name}</Text>
              <Text style={[type.small, { marginTop: 2 }]}>{hospital.address ?? 'Address not mapped'}</Text>
            </View>
            {hospital.phone !== undefined ? (
              <Pressable
                onPress={() => void Linking.openURL(`tel:${hospital.phone!.replace(/\s/g, '')}`)}
                style={styles.call}
              >
                <Text style={styles.callText}>Call</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
      <Text style={[type.foot, { marginTop: 8 }]}>
        Location and address are real (OpenStreetMap). Specialties and bed counts, where shown
        elsewhere, are simulated — no public API publishes live bed availability.
      </Text>
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.xl, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  name: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: colors.ink },
  call: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 14 },
  callText: { fontFamily: fonts.sansBold, fontSize: 11.5, color: colors.white },
});
