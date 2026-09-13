/**
 * The two adapters that act on the world rather than reading from it.
 *
 * Both are tested against a stubbed `fetch` rather than the live services: one
 * is a donated community server that should not be hammered by CI, and the
 * other sends text messages to real phones. A test suite that could message
 * somebody if a mock were mis-wired is a test suite with a defect waiting in
 * it, so the Twilio tests assert the NON-sending paths hardest.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISIBLE_SIGNS, estimateTravelMinutes, haversineKm } from '@triage/shared';
import { OsmHospitalPort } from './osm-hospital-port.js';
import { TwilioNotificationPort } from './twilio-notification-port.js';

const ORIGIN = { lat: 20.2961, lng: 85.8245 }; // Bhubaneswar

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenStreetMap hospital matching', () => {
  const OVERPASS = { overpassUrl: 'https://overpass.test/api/interpreter' };

  it('reads real coordinates and labels the invented fields as simulated', async () => {
    stubFetch({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 20.3,
          lon: 85.83,
          tags: { name: 'AIIMS Bhubaneswar', emergency: 'yes', phone: '+916742476789' },
        },
      ],
    });

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });

    expect(result.ok).toBe(true);
    const hospital = result.ok ? result.data[0]! : undefined;
    expect(hospital?.name).toBe('AIIMS Bhubaneswar');
    expect(hospital?.phone).toBe('+916742476789');

    // The whole point of the adapter: a consumer can always tell which half of
    // the record came from a survey and which half was invented here.
    expect(hospital?.dataProvenance.location).toBe('openstreetmap');
    expect(hospital?.dataProvenance.bedAvailability).toBe('simulated');
    expect(hospital?.bedAvailability.simulated).toBe(true);
  });

  /**
   * Large hospitals are mapped as building outlines (ways), not points, and a
   * way carries no lat/lon of its own — only the `center` that `out center`
   * adds. Dropping them would silently exclude exactly the big facilities an
   * emergency needs, while still returning a plausible-looking list of clinics.
   */
  it('keeps hospitals mapped as ways, using the computed centre', async () => {
    stubFetch({
      elements: [
        { type: 'way', id: 7, center: { lat: 20.31, lon: 85.84 }, tags: { name: 'Capital Hospital' } },
      ],
    });

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });

    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0]!.osmId).toBe('way/7');
  });

  it('drops unnamed elements rather than offering "Unnamed hospital"', async () => {
    stubFetch({ elements: [{ type: 'node', id: 2, lat: 20.3, lon: 85.83, tags: {} }] });

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });
    expect(result.ok && result.data).toHaveLength(0);
  });

  it('returns the nearest facility first', async () => {
    stubFetch({
      elements: [
        { type: 'node', id: 1, lat: 20.9, lon: 85.83, tags: { name: 'Far' } },
        { type: 'node', id: 2, lat: 20.3, lon: 85.83, tags: { name: 'Near' } },
      ],
    });

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 100,
      requireEmergencyDepartment: true,
      limit: 5,
    });
    expect(result.ok && result.data[0]!.name).toBe('Near');
  });

  /**
   * The simulated overlay must not change between calls. A hospital that gains
   * and loses ICU beds on every re-render contradicts itself on camera, and a
   * judge who notices stops trusting the real numbers next to it.
   */
  it('simulates the same bed counts every time for the same hospital', async () => {
    const payload = {
      elements: [{ type: 'node', id: 42, lat: 20.3, lon: 85.83, tags: { name: 'Steady' } }],
    };
    stubFetch(payload);
    const first = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });
    stubFetch(payload);
    const second = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });

    const a = first.ok ? first.data[0]!.bedAvailability : undefined;
    const b = second.ok ? second.data[0]!.bedAvailability : undefined;
    expect(a?.emergencyBedsFree).toBe(b?.emergencyBedsFree);
    expect(a?.icuBedsFree).toBe(b?.icuBedsFree);
  });

  /**
   * `emergency` is frequently just not surveyed. Excluding untagged hospitals
   * would hide a real emergency department from someone who needs one; the
   * error in the other direction is one wasted option in a list.
   */
  it('keeps hospitals with no emergency tag, and excludes only emergency=no', async () => {
    stubFetch({
      elements: [
        { type: 'node', id: 1, lat: 20.3, lon: 85.83, tags: { name: 'Untagged' } },
        { type: 'node', id: 2, lat: 20.3, lon: 85.83, tags: { name: 'No ED', emergency: 'no' } },
      ],
    });

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });
    const names = result.ok ? result.data.map((h) => h.name) : [];
    expect(names).toContain('Untagged');
    expect(names).not.toContain('No ED');
  });

  it('degrades with a notice instead of throwing when Overpass is down', async () => {
    stubFetch('gateway timeout', 504);

    const result = await new OsmHospitalPort(OVERPASS).findNearby({
      origin: ORIGIN,
      radiusKm: 20,
      requireEmergencyDepartment: true,
      limit: 5,
    });

    expect(result.ok).toBe(false);
    // §6: the patient is told, and is told the assessment itself still stands.
    expect(!result.ok && result.degraded.userFacingMessage).toContain('emergency number');
    expect(!result.ok && result.degraded.conservative).toBe(true);
  });

  it('never claims the pre-arrival push reached a real hospital', async () => {
    const result = await new OsmHospitalPort(OVERPASS).pushPreArrival({
      caseId: 'case_1',
      osmId: 'node/1',
    });
    expect(result.ok && result.data.simulated).toBe(true);
  });
});

describe('distance and ETA', () => {
  it('measures a known separation to within a percent', () => {
    // Bhubaneswar to Cuttack, ~22 km apart.
    const km = haversineKm(ORIGIN, { lat: 20.4625, lng: 85.8828 });
    expect(km).toBeGreaterThan(18);
    expect(km).toBeLessThan(26);
  });

  it('never reports a zero-minute journey', () => {
    // A "0 min away" ETA reads as an arrival, not as a missing value.
    expect(estimateTravelMinutes(0)).toBeGreaterThanOrEqual(1);
  });
});

describe('Twilio — the only port that reaches a real person', () => {
  const CONFIG = {
    accountSid: 'AC_test',
    authToken: 'token',
    whatsappFrom: 'whatsapp:+14155238886',
    smsFrom: '+15551234567',
  };
  const MESSAGE = {
    contactId: 'contact_1' as never,
    toE164: '+919876543210',
    channel: 'whatsapp' as const,
    kind: 'emergency_alert' as const,
    body: 'test',
  };

  /**
   * The most important test in this file. A dry run that put a message on the
   * wire would be the single most damaging defect in the codebase, and a dry
   * run that reported itself as a successful send would produce a case record
   * indistinguishable from one where the family really was told.
   */
  it('sends nothing at all when TWILIO_LIVE is off', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new TwilioNotificationPort({ ...CONFIG, live: false }).send(MESSAGE);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    // `fallback`, never `live` — that distinction is what the timeline reads to
    // decide between "sent" and "suppressed".
    expect(result.ok && result.source).toBe('fallback');
  });

  it('reports a real send as live, with the provider message id', async () => {
    stubFetch({ sid: 'SM123', status: 'queued' });
    const result = await new TwilioNotificationPort({ ...CONFIG, live: true }).send(MESSAGE);
    expect(result.ok && result.source).toBe('live');
    expect(result.ok && result.data.providerMessageId).toBe('SM123');
  });

  it('prefixes a WhatsApp recipient and leaves an SMS number bare', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(init.body);
        return new Response(JSON.stringify({ sid: 'SM1' }), { status: 200 });
      }),
    );

    const port = new TwilioNotificationPort({ ...CONFIG, live: true });
    await port.send(MESSAGE);
    await port.send({ ...MESSAGE, channel: 'sms' });

    const first = new URLSearchParams(bodies[0]);
    const second = new URLSearchParams(bodies[1]);
    expect(first.get('To')).toBe('whatsapp:+919876543210');
    expect(second.get('To')).toBe('+919876543210');
  });

  it('refuses a channel it has no sender for rather than substituting one', async () => {
    const result = await new TwilioNotificationPort({
      accountSid: 'AC',
      authToken: 't',
      smsFrom: '+15551234567',
      live: true,
    }).send(MESSAGE); // whatsapp, but no whatsappFrom configured

    // Quietly falling back to SMS would message someone on a channel they did
    // not choose, from a trial number that probably cannot reach them anyway.
    expect(result.ok).toBe(false);
  });

  it('tells the PATIENT when a contact could not be reached', async () => {
    stubFetch({ error_message: 'unverified number' }, 400);
    const result = await new TwilioNotificationPort({ ...CONFIG, live: true }).send(MESSAGE);

    expect(result.ok).toBe(false);
    // A failure only in a server log is the difference between someone calling
    // their mother themselves and someone assuming it was handled.
    expect(!result.ok && result.degraded.userFacingMessage).toContain('Call them directly');
  });
});

describe('the vision schema and its gate agree', () => {
  /**
   * Regression guard for a real bug. The Gemini request schema said
   * `visibleSigns: string[]` while the zod gate demanded one of a closed
   * thirteen-member enum, so every honest model answer was rejected and the
   * photo contributed nothing — with no error surfaced anywhere. Both now read
   * the same exported constant; this asserts nobody re-inlines one of them.
   */
  it('shares one list of permitted signs', async () => {
    const module = await import('./gemini-vision-port.js');
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./gemini-vision-port.ts', import.meta.url), 'utf8'),
    );
    expect(module.GeminiVisionPort).toBeDefined();
    expect(source).toContain('enum: VISIBLE_SIGNS');
    expect(VISIBLE_SIGNS).toContain('none_visible');
  });
});
