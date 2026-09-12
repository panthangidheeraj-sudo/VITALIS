# Adaptive Emergency Triage Agent

Tech Zephyr 4.0 — Agentic AI Hackathon, IIT Bhubaneswar. Problem Statement 2.

An autonomous patient-triage agent that conducts an adaptive interview, calls a
deterministic clinical scoring engine, maintains persistent case state, decides
among predefined routing outcomes, and re-plans when new or contradictory
information appears.

**Guardrail:** decision support in a simulated environment. The system never
autonomously diagnoses or prescribes.

---

## Status

| Slice | State |
|---|---|
| `packages/shared` — contracts, case-state model, tool ports, routing policy, schemas | **Done.** 81 tests passing. |
| `packages/agent` — the Observe→Decide→Act→Evaluate→Adapt loop | **Done.** 39 tests passing. Runs end-to-end with zero API keys. |
| `packages/server` — Express orchestrator, Firestore adapter | **Done.** 13 tests passing (133 total). Four endpoints wrapping the agent loop; real external adapters slot in behind the existing ports as credentials arrive. |
| `packages/mobile` — **React Native (Expo) app, Android + iOS** | **Done.** Typechecks clean and bundles for both platforms. Needs a phone + the running server to verify interactively. |
| `packages/web` — *superseded* | Holds only `.env` files. See "The web/mobile pivot" below. |

**Platform decision:** the final deliverable is a React Native (Expo) mobile app,
not a web PWA. Expo Go is the target runtime — no native build step, so it runs
on a real phone by scanning a QR code.

```bash
npm install
npm run typecheck && npm test          # backend: 133 tests

npm run dev  -w @triage/server         # terminal 1: orchestrator on :8787
npm run start -w @triage/mobile        # terminal 2: Expo, then scan the QR
```

No API keys and no network access are required to typecheck or test.

---

## Architecture

```
Mobile app (React Native / Expo)     ← holds NO API keys
   │  reads live via Firestore listeners
   │  writes turns + gate confirmation via the orchestrator
   ▼
Firestore  cases/{caseId}            ← persistent case state
   ▲
   │  Admin SDK
Orchestrator (packages/agent + packages/server)
   │
   ├─→ Groq              select question · detect contradiction · read tone · translate · vision
   ├─→ Infermedica       /parse → concept ids, then /triage → THE risk classification
   ├─→ MedlinePlus       plain-language explanation + citation
   ├─→ RxNorm / RxNav    medication normalisation
   ├─→ WHO ICD-11        standardised coding of the derived category
   ├─→ OpenStreetMap     real hospital coordinates (+ simulated specialty/bed overlay)
   └─→ Twilio            emergency-contact alerts (WhatsApp default)
```

### The three axes

Every turn produces all three, together (`TurnReadout`):

| Axis | Source | Question it answers |
|---|---|---|
| **Risk** | Infermedica `/triage` only | How bad is this? |
| **Confidence** | Contradiction detection + evidence reliability | How much should I believe what I'm told? |
| **Communication** | Groq classification of the patient's phrasing | How should I say it? |

Tracking risk and confidence *separately* is the headline idea. A low-confidence
Green is not a green light — it is a reason to ask harder questions.

### The agent loop (`packages/agent`)

`orchestrateTurn(state, input, tools)` is the whole Observe→Decide→Act→Evaluate→Adapt
cycle as one pure(ish) function: given a case state, one piece of input, and
the tool ports from `@triage/shared`, it returns the updated state, the turn
record, the timeline entries it produced, and the tool-call ledger. It never
touches a store directly — `run-turn.ts` wraps it with the revision-checked
Firestore write, so a Companion Mode tick and a live answer landing at the
same moment can't silently clobber each other.

Two design decisions worth knowing about before touching this code:

- **Contradiction resolution requires an independent second source.** A
  contradiction is created from two disagreeing evidence items; if resolving
  it only needed one of those same two items, the agent would settle a
  dispute using the very evidence that raised it. So `resolveContradictions`
  only closes a contradiction when a THIRD, independent item touching the
  same concept arrives later — exactly the "ask harder-to-deflect follow-ups"
  behavior §5.1 requires, not just a label on top of accepting the flip at
  face value. `orchestrator.test.ts` has a named regression test for this.
- **Post-confirmation action is a separate function.** `orchestrateTurn`
  only ever *proposes* a routing decision; `confirmRouting` is what runs
  hospital matching, the pre-arrival push, and dispatch, and it refuses to
  run at all unless the safety gate's `state` is already `'satisfied'`. This
  keeps "decide" and "act on a confirmed decision" as two distinct,
  separately-testable steps, matching the press-and-hold requirement in §5.2.

Everything is testable with zero API keys: `packages/agent/src/testing/`
provides a deterministic clock, an in-memory Firestore-shaped store, and
keyword-lexicon stand-ins for Groq and Infermedica. `LocalDeterministicScorer`
(the real §6 fallback engine, not just a test double) is deterministic by
design, so the whole loop — including a full contradiction → adaptation →
escalation walkthrough — runs and is asserted on in CI without touching the
network.

### The mobile app (`packages/mobile`)

Expo SDK 57, Android + iOS, running in Expo Go. Three screens matching §9: Home
(vitals dashboard, medication reminders, Emergency button), Confirmation and
details (quick-select symptom tags, adaptive interview, press-and-hold gate),
and Live tracking (map, ETA, always-visible Cancel Alert). Plus an offline
first-aid screen.

- **Firestore listeners, not polling.** `src/firebase/useCaseState.ts`
  subscribes to the three streams `liveListenerTargets()` already names in
  `@triage/shared`. The server writes a new risk tier and the phone updates
  unprompted — that push is the §3.1 scored behaviour and the core of the demo.
- **The press-and-hold gate imports its duration from `@triage/shared`**, so
  the UI and the server's validation cannot disagree about what "3 seconds"
  means. Releasing early resets to zero; a tap does nothing.
- **Offline first-aid replaces the service worker.** React Native has no
  service-worker layer, so content is bundled into the app (offline by
  construction) and mirrored into AsyncStorage so it can be refreshed over the
  air later. Reads fall back to the bundled copy on any storage failure.
- **No credentials on the device.** Only the public Firebase web config
  (`EXPO_PUBLIC_*`), which is public by design. Groq, Infermedica and Twilio
  keys exist only in the server's root `.env`.

Two deliberate deviations worth knowing:

- **No expo-router.** The flow is linear and the app wants to *control* the
  Android back button rather than delegate it — popping out of an active
  dispatch would be wrong. Screen state is a discriminated union in `App.tsx`.
- **`react-native-maps` is loaded via `require()` in a try/catch.** It has a
  history of rendering blank in Expo Go on some SDK versions; a static import
  would take the whole tracking screen down with it. On failure `MapPanel`
  degrades to a coordinate card, and ETA/destination/cancel all still work.

### The orchestrator (`packages/server`)

Four endpoints — create case, submit turn, confirm, cancel — wrapping the
agent loop. It prints its real capabilities at boot rather than pretending to
be fully wired:

```
Firestore      : DISABLED — no GOOGLE_APPLICATION_CREDENTIALS...
Clinical scorer: LOCAL FALLBACK — no INFERMEDICA_APP_ID/APP_KEY...
```

`FirestoreCaseStore.update()` maps the port's revision check onto a Firestore
**transaction** — a read-then-write would reintroduce the lost-update race the
revision counter exists to prevent, and here that means a reported symptom
silently vanishing.

**Case ownership.** `CaseState.ownerUid` is required, not optional, and
`POST /cases` rejects a request without one. `firebase/firestore.rules` matches
reads against it, so a case written without an owner is invisible to every
client — a failure with no error message anywhere, which would surface as a live
view that simply never populates. Making the field mandatory turns that into a
compile error and a 400 instead. The client never writes to Firestore at all;
the confirm and cancel intents go over HTTP so the press-and-hold gate has
exactly one enforcement point.

### Two invariants the code enforces structurally

1. **The model cannot score.** No Groq output schema contains a risk tier,
   triage level or severity field, so the model has nowhere to put one.
   Asserted in `groq-outputs.test.ts`.
2. **Tone adapts; rigor does not.** No function in `policy/risk-policy.ts`
   accepts a communication state. A panicked user gets identical tiers, allowed
   outcomes and safety gates to a calm one — only the wording differs. Asserted
   in `risk-policy.test.ts`.

---

## The six-beat demo

`packages/shared/fixtures/demo-chest-pain.json` encodes the entire judged
sequence as real case state, and `demo-fixture.test.ts` validates it against the
same schema the Firestore read path uses. If the schema cannot express the demo,
the tests fail.

| Beat | Time | What happens |
|---|---|---|
| Goal | 07:00 | Patient reports chest discomfort — incomplete state, one evidence item |
| Decision | 07:00 | Agent selects "does the pain spread?" over "rate it 1–10", with a stated rationale |
| Action | 07:01 | `/parse` → concept ids → `/triage` with accumulated evidence |
| Intermediate result | 07:01 | `consultation_24` → **Yellow**, confidence medium (answers are terse) |
| Adaptation | 07:02–07:05 | Pain spreads to left arm → agent abandons its queued question and re-scores; caregiver contradicts the patient's "not sweating" → **Confidence Alert** blocks routing until resolved; shortness of breath begins → **Red** |
| Final outcome | 07:05–07:07 | Ambulance behind a 3-second press-and-hold, hospital matched on cardiology + free beds, pre-arrival summary sent, Companion Mode continues |

---

## The web/mobile pivot

The final deliverable moved from a web PWA to React Native (Expo). **Nothing was
discarded:** `packages/web` never contained an app — only `.env` files — so
there was no PWA to replace, no service-worker cache to re-architect, and no
fallback demo path lost. `packages/shared` and `packages/agent` were not touched
by the pivot (verifiable: `git status packages/shared packages/agent` is empty),
because nothing platform-specific was ever written into them.

`packages/web` is retained for now but is **not a fallback** — it is two env
files. It should be deleted once the mobile app is confirmed working on a
device; carrying an empty package into submission invites a judge to open it and
find nothing.

---

## Deviations from the spec

Flagged rather than silently applied. Each was a conflict between the locked
spec and either a hard platform constraint or a free-tier-only budget.

| Spec | Reality | What was built |
|---|---|---|
| §3.1 orchestrator as Cloud Functions | Cloud Functions requires the **Blaze** billing plan for any outbound call to Groq/Infermedica/Twilio | Orchestrator is framework-agnostic TypeScript; Express adapter runs it free. Firestore stays on free Spark, so persistent state and live listeners are unaffected. A Cloud Functions adapter is the documented production path. |
| §3 Google Places for hospitals | Places needs a billing card even inside its free credit | OpenStreetMap Overpass/Nominatim — free, keyless, real coordinates — behind `HospitalPort`. Places is a one-file swap. |
| §6 triage returns 3 levels | `/triage` returns **five**: `emergency_ambulance`, `emergency`, `consultation_24`, `consultation`, `self_care`. `serious` is a separate array of flagged evidence, not a level | Explicit 5→3 mapping in `TRIAGE_LEVEL_TO_TIER`; `serious[]` drives the "classic presentation" flag instead |
| §4 Act: call `/triage` with evidence | `/triage` accepts concept ids (`s_*`, `p_*`), never free text | Added `EvidenceNormalizationPort` (`/parse`) as a required step. A net gain — one more genuine conditional tool call. |
| §3 Twilio SMS | India A2P SMS needs DLT registration; trial reaches verified numbers only | WhatsApp sandbox is the default channel; SMS kept behind the same port |
| §6 Infermedica scoring | Trial accounts cap `/triage` calls | `local_fallback` scoring source with a mandatory `degradedReason`, surfaced as a visible banner — never a silent substitution |

---

## Connecting Firebase (free Spark plan — do **not** upgrade)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
   Skip Google Analytics. Stay on **Spark**.
2. **Build → Firestore Database → Create database** → *Start in test mode* →
   region **`asia-south1` (Mumbai)**.
3. **Project settings → General → Your apps → Web (`</>`)** → register the app →
   copy the `firebaseConfig` object. This is the **mobile** config; it goes in
   `packages/mobile/.env` as `EXPO_PUBLIC_FIREBASE_*` (already populated). These
   values are public by design — the security rules, not secrecy, protect the
   data.
4. **Project settings → Service accounts → Generate new private key** →
   downloads a JSON file. This is the **backend** Admin credential. Save it
   **outside this repository** and put its path in the root `.env` as
   `GOOGLE_APPLICATION_CREDENTIALS`. It is already gitignored; never commit it.
5. **Authentication → Sign-in method → Anonymous → Enable.** Free, no signup
   flow, and no longer optional: `CaseState.ownerUid` is a required field and
   `firestore.rules` scopes every read to `request.auth.uid`. Without it the
   app falls back to a local device id, which will not satisfy the rules — so
   once test mode is turned off, the live view goes blank.
6. **Do not enable Cloud Functions.** It forces the Blaze plan. The Express
   orchestrator covers the same ground for free.

Items **3** and **4** are wired in. The Admin credential lives at
`C:/Users/User/.secrets/firebase-admin-medical-ai-hackathon.json` — outside the
repo, referenced from the root `.env`. Steps **2** and **5** are still pending.

### Other keys, when you have them

All free tier, no card required: Groq ([console.groq.com/keys](https://console.groq.com/keys)),
Infermedica ([developer.infermedica.com](https://developer.infermedica.com/)),
WHO ICD-11 ([icd.who.int/icdapi](https://icd.who.int/icdapi)), Twilio trial.
MedlinePlus, RxNav and OpenStreetMap need no auth at all.

Copy `.env.example` to `.env` and fill in what you have — every tool degrades
explicitly when its key is absent rather than crashing the loop.

---

## Open items

1. **Concept ids are placeholders.** Those in the demo fixture, `quick-select.ts`
   and the server's `demo-lexicon.ts` (`s_21`, `s_98`, `s_13`, `s_47`, `p_8`…)
   are correctly shaped and internally consistent, but must be reconciled
   against a live `/parse` response once `INFERMEDICA_APP_ID` exists.

2. **Cloud Firestore is not enabled on the Firebase project yet.** The Admin
   credential is valid and the server boots with `Firestore: ENABLED`, but the
   first write returns `SERVICE_DISABLED` — the database itself has never been
   created. Fix it in one step: **Build → Firestore Database → Create database**
   (test mode, region `asia-south1`). Nothing in the code changes. Until then
   the server answers with a 500 rather than dying, but no case is persisted and
   the phone has nothing to listen to.

3. **Running on a physical phone needs a LAN IP, not `localhost`.**
   `EXPO_PUBLIC_API_URL` currently points at `localhost:8787`, which only works
   on an emulator — on a real device `localhost` is the phone itself. Set it to
   the address `npx expo start` prints and restart the dev server (Expo inlines
   these at bundle time, so a reload alone will not pick it up). The Home screen
   surfaces this as "Orchestrator unreachable" with that exact hint.

4. **Not yet verified interactively.** The app typechecks and bundles for both
   platforms, and the server is exercised by 13 HTTP tests, but the
   phone → server → loop → phone round trip has not been run on a device.
