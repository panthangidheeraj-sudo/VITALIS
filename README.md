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
| `packages/shared` — contracts, case-state model, tool ports, routing policy, schemas | **Done.** Typechecks clean, 81 tests passing. |
| `packages/agent` — the Observe→Decide→Act→Evaluate→Adapt loop | **Done.** Typechecks clean, 39 tests passing (120 total across the workspace). Runs end-to-end with zero API keys, against a deterministic local scorer and mock Groq/Infermedica/hospital adapters. |
| `packages/server` — Express orchestrator, real API adapters | Next |
| `packages/web` — React + Vite PWA, 3-screen flow | After server |

```bash
npm install
npm run typecheck
npm test
```

No API keys and no network access are required for either command.

---

## Architecture

```
Frontend (React + Vite PWA)          ← holds NO API keys
   │  reads live via Firestore listeners
   │  writes only two intents: gate-hold, cancel
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
   copy the `firebaseConfig` object. This is the **frontend** config; it goes in
   `packages/web/.env` as `VITE_FIREBASE_*`. These values are public by design —
   the security rules, not secrecy, are what protect the data.
4. **Project settings → Service accounts → Generate new private key** →
   downloads a JSON file. This is the **backend** Admin credential. Save it
   **outside this repository** and put its path in the root `.env` as
   `GOOGLE_APPLICATION_CREDENTIALS`. It is already gitignored; never commit it.
5. *(Optional, free)* **Authentication → Sign-in method → Anonymous** — gives
   each device a stable uid so `firestore.rules` can scope a case to its owner,
   with no signup flow.
6. **Do not enable Cloud Functions.** It forces the Blaze plan. The Express
   orchestrator covers the same ground for free.

Send me items **3** and **4** and I'll wire them in.

### Other keys, when you have them

All free tier, no card required: Groq ([console.groq.com/keys](https://console.groq.com/keys)),
Infermedica ([developer.infermedica.com](https://developer.infermedica.com/)),
WHO ICD-11 ([icd.who.int/icdapi](https://icd.who.int/icdapi)), Twilio trial.
MedlinePlus, RxNav and OpenStreetMap need no auth at all.

Copy `.env.example` to `.env` and fill in what you have — every tool degrades
explicitly when its key is absent rather than crashing the loop.

---

## Open item

Concept ids in the demo fixture (`s_21`, `s_98`, `s_13`, `s_47`, `p_8`) are
**placeholders**. They are correctly shaped and satisfy the schema, but must be
reconciled against a live `/parse` response once `INFERMEDICA_APP_ID` is
available. Nothing else depends on their exact values.
