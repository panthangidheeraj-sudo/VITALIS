# Design source

`VitalisApp.dc.html` is the Claude Design export, unpacked from
`Vitalis App - Standalone.html` (the bundler wraps the real files as base64 in a
`__bundler/manifest` script tag). It is the REFERENCE for the mobile UI, not
something the app builds or ships.

`vitalis-lines.js` is the WebGL wave-field that sits behind the assistant
screen. React Native has no WebGL here, so `src/ui/WaveField.tsx` reproduces it
with react-native-svg — same three bands, same blue gradient, same slow drift.

`support.js` (the Design Claude runtime) is deliberately NOT kept: it is 69 KB
of generated framework code for rendering `.dc.html` in a browser, and nothing
in this repo reads it.

## Where the design and this build deliberately differ

The design was drawn before some of the backend existed, and a few of its
labels assert things that are no longer true. Those were corrected rather than
copied, because a screenshot that says the wrong tool ran is worse than an
ugly one:

| Design says | This build shows | Why |
|---|---|---|
| Ledger: `infermedica /parse`, `infermedica /triage` | The real tool-call ledger from Firestore | Infermedica was dropped; the scorer is the local rule engine. Printing a vendor we do not call would be a false provenance claim. |
| Handoff: `engine: infermedica /triage` | `engine: <risk.source>` | Same reason. |
| Degraded banner: "Infermedica /triage is unavailable" | `degradation.notice` from case state | The banner must say what actually degraded. |
| Photo: "No vision model is enabled" | Driven by `/health` | Gemini is live now. |
| Risk language: green / yellow / red | green / yellow / **orange** / red | The scale gained a fourth tier after the design was drawn. |
| Tracking: AIIMS, AMB-14, ETA 9 | `state.hospital`, `state.dispatch` | Real OSM match and real distance. |

## Adaptations forced by React Native

- `backdrop-filter` glass → translucent fills. `expo-blur` would be literal, but
  this design has ~8 glass surfaces per screen and Android blur in Expo Go is
  slow enough to drop frames on the one screen that must never stutter.
- CSS keyframes → `Animated`. The decorative ones (blobs, breathing, marquee)
  were dropped; the ones that carry meaning (the hold ring, count-ups, fade-in
  on state change) were kept.
- `conic-gradient` hold ring → an SVG arc, which is what it should have been
  anyway: the ring is now driven by the same `PRESS_AND_HOLD_DURATION_MS` the
  server enforces, so the animation cannot drift from the policy.
