import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import type { BiologicalSex, CaseId } from '@triage/shared';
import { api, ApiError, resolveOwnerUid, type CaseSummary, type ConfirmResult, type TurnResponse } from '../api/client';
import { QUICK_SELECT_OPTIONS } from '../data/quickSelectTags';
import { HoldButton } from '../components/HoldButton';
import { HospitalsPanel } from '../components/HospitalsPanel';
import { PhoneIcon } from '../components/icons';
import { EMERGENCY_NUMBER } from '../data/firstAidContent';
import { useContacts } from '../data/contactsStore';
import { useProfile } from '../data/profileStore';

const TIER_COLOR: Record<string, string> = { green: '#15803D', yellow: '#D97706', orange: '#EA580C', red: '#DC2626' };
const TIER_LABEL: Record<string, string> = { green: 'LOW RISK', yellow: 'ELEVATED', orange: 'URGENT', red: 'CRITICAL' };
const NOTIFY_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  suppressed: 'Not sent (dry run)',
};

/**
 * Ported from packages/mobile/src/screens/EmergencyScreen.tsx. Two real
 * differences from the mobile screen, both explicit trade-offs for this
 * pass rather than oversights:
 *   - No live Firestore listener (the web app doesn't wire up Firebase) —
 *     state comes from each POST response only, the same "works from POST
 *     responses alone when Firebase isn't configured" degraded path the
 *     mobile screen already has, just used as the only path here.
 *   - Demographics are a real two-field form here instead of a stored
 *     profile, since the web app has no profile/contacts screen in this pass.
 */
export function Emergency() {
  const [searchParams] = useSearchParams();
  const openCaseId = searchParams.get('case') as CaseId | null;
  const { contacts } = useContacts();
  const { profile } = useProfile();

  const [caseId, setCaseId] = useState<CaseId | undefined>(openCaseId ?? undefined);
  const [summary, setSummary] = useState<CaseSummary | undefined>(undefined);
  const [lastTurn, setLastTurn] = useState<TurnResponse['turn'] | undefined>(undefined);
  const [ageYears, setAgeYears] = useState('30');
  const [sex, setSex] = useState<BiologicalSex>('female');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifyContacts, setNotifyContacts] = useState(true);
  const [shareLocation, setShareLocation] = useState(false);
  const [notifications, setNotifications] = useState<ConfirmResult['notifications']>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (openCaseId === null) return;
    let cancelled = false;
    // There is no `/cases/:id` summary-shaped GET the way the mobile client
    // uses it here — a full CaseState is a strict superset, and this screen
    // only reads the summary fields, so requesting it as one is safe. This
    // fetch happens once, when the Assistant screen hands off an existing
    // case id via the URL.
    fetch(`${api.baseUrl}/cases/${openCaseId}`)
      .then((r) => r.json())
      .then((state) => {
        if (cancelled) return;
        setSummary({
          caseId: state.caseId,
          revision: state.revision,
          status: state.status,
          riskTier: state.risk.tier,
          triageLevel: state.risk.triageLevel,
          scoringSource: state.risk.source,
          degraded: state.degradation.clinicalScoringDegraded,
          confidence: { score: state.confidence.score, level: state.confidence.level },
          confidenceAlertActive: state.confidence.alertActive,
          communicationState: state.communication.state,
          turnCount: state.turnCount,
          routing: state.routing,
          dispatch: state.dispatch,
          escalation: state.escalation,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this case.');
      });
    return () => {
      cancelled = true;
    };
  }, [openCaseId]);

  const applyTurn = useCallback((result: TurnResponse) => {
    setSummary(result);
    setLastTurn(result.turn);
  }, []);

  const startCase = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createCase({ ownerUid: resolveOwnerUid(), ageYears: Number(ageYears) || 30, sex });
      setCaseId(created.caseId);
      setSummary(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a case.');
    } finally {
      setBusy(false);
    }
  }, [ageYears, sex]);

  const submitTags = useCallback(async () => {
    if (caseId === undefined || selected.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      applyTurn(await api.submitQuickSelect(caseId, selected));
      setSelected([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }, [applyTurn, caseId, selected]);

  const submitAnswer = useCallback(async () => {
    if (caseId === undefined || answer.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      applyTurn(await api.submitText(caseId, answer.trim()));
      setAnswer('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }, [answer, applyTurn, caseId]);

  const confirm = useCallback(
    async (heldMs: number) => {
      if (caseId === undefined) return;
      // Captured BEFORE the request: `summary.routing.outcome` is what the
      // hold-and-release gesture the caller just completed actually
      // confirmed. `dispatch.status` on the response that follows would say
      // the same thing, but reading it there would mean re-deriving "was
      // this the ambulance outcome" from a field this app has always
      // labelled `simulated: true` — see confirm-routing.ts. Nothing here
      // treats that response as a real dispatch call; it never has been one
      // and there is no service to call. Calling 108 is the one action that
      // genuinely happens, and it happens because the outcome the user just
      // confirmed said "ambulance", not because the server said anything.
      const wasAmbulance = summary?.routing?.outcome === 'ambulance_dispatch';
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.confirm(caseId, heldMs, {
          contacts: notifyContacts ? contacts : undefined,
          patientName: profile.displayName.trim().length > 0 ? profile.displayName.trim() : undefined,
          shareLocation,
        });
        setSummary(result);
        setNotifications(result.notifications);
        if (wasAmbulance) {
          // Still inside the async chain the hold-and-release started, so
          // most mobile browsers honour this as a user-activated navigation
          // rather than blocking it as an unprompted redirect. It is a
          // courtesy attempt, not the only path to the call: the banner
          // rendered below (dispatch.status === 'dispatch_requested') is a
          // real `tel:` link and stays on screen either way, for the
          // browsers that do block it and for anyone who dismisses the
          // dialer without completing the call.
          window.location.href = `tel:${EMERGENCY_NUMBER}`;
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not confirm.');
      } finally {
        setBusy(false);
      }
    },
    [caseId, summary, notifyContacts, contacts, profile.displayName, shareLocation],
  );

  if (caseId === undefined) {
    return (
      <div className="page fade-up">
        <h1 className="h1">Emergency triage</h1>
        <p className="body-text">A few details first, so the clinical engine can score correctly.</p>
        <div className="glass card">
          <div className="label">Age (years)</div>
          <input className="text-input" style={{ width: '100%', marginTop: 6 }} value={ageYears} onChange={(e) => setAgeYears(e.target.value)} type="number" min={0} max={130} />
          <div className="label" style={{ marginTop: 14 }}>
            Sex
          </div>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            {(['female', 'male'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSex(option)}
                className="btn"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  textTransform: 'capitalize',
                  background: sex === option ? 'var(--brand)' : 'rgba(255,255,255,0.6)',
                  color: sex === option ? '#fff' : 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => void startCase()} disabled={busy}>
          {busy ? 'Starting…' : 'Start emergency triage'}
        </button>
        {error !== undefined ? <p className="small" style={{ color: 'var(--danger-deep)' }}>{error}</p> : null}
      </div>
    );
  }

  const tier = summary?.riskTier ?? 'green';
  const awaitingConfirmation = summary?.status === 'awaiting_confirmation' && summary.routing !== undefined;
  const question = lastTurn?.question;

  return (
    <div className="page">
      <h1 className="h1 fade-up">Emergency triage</h1>

      {/* Emergency is "more serious than the other screens" — fast, restrained
          entrance (glass-emerge-fast: 220ms, not the app's usual 380ms), no
          stagger beyond this one card, and no decorative motion competing
          with the instructions that follow. */}
      <div className="glass glass-lift glass-emerge-fast" style={{ borderRadius: 20, overflow: 'hidden' }}>
        <div style={{ background: TIER_COLOR[tier], padding: 18, color: '#fff' }}>
          <div className="label" style={{ color: 'rgba(255,255,255,0.82)' }}>
            Risk · clinical engine
          </div>
          <div className="h2" style={{ color: '#fff', marginTop: 6 }}>
            {TIER_LABEL[tier]}
          </div>
        </div>
        <div style={{ padding: 18, background: 'rgba(255,255,255,0.7)' }}>
          <div className="label">Confidence</div>
          <div style={{ marginTop: 8, fontWeight: 700, fontSize: 14 }}>{summary?.confidence.level}</div>
        </div>
      </div>

      {summary?.degraded === true ? (
        <div className="glass card" style={{ borderLeft: '4px solid var(--warn)', background: 'var(--warn-wash)' }}>
          <div className="label" style={{ color: 'var(--warn-deep)' }}>
            Degraded scoring
          </div>
          <p className="small" style={{ marginTop: 6 }}>{summary.degradationNotice ?? 'Running on the conservative fallback.'}</p>
        </div>
      ) : null}

      {question !== undefined ? (
        <div className="glass glass-strong card">
          <div className="label">{question.hardToDeflect ? 'I need a clear answer on this' : 'Next question'}</div>
          <p style={{ marginTop: 8, fontSize: 16, fontWeight: 600 }}>{question.text}</p>
          <p className="foot" style={{ marginTop: 8, borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
            Why I asked: {question.rationale}
          </p>
        </div>
      ) : null}

      {awaitingConfirmation && summary?.routing !== undefined ? (
        // The attention pulse is deliberately the ONLY continuously-animating
        // thing on this screen, and only appears on a control that is
        // genuinely urgent — a confirmed routing decision waiting on the
        // press-and-hold gate. It never appears just because a case exists.
        <div className="glass card attn-pulse" style={{ border: '2px solid rgba(220,38,38,0.5)' }}>
          <div className="label" style={{ color: 'var(--danger-deep)' }}>
            Recommended outcome
          </div>
          <div className="h2" style={{ marginTop: 6, color: 'var(--danger-deep)', textTransform: 'capitalize' }}>
            {summary.routing.outcome.replace(/_/g, ' ')}
          </div>
          <p className="small" style={{ marginTop: 6 }}>{summary.routing.gate.consequenceStatement}</p>
          {contacts.length > 0 ? (
            // Both default sensibly rather than to "off": notifying the
            // contacts the user specifically added is the point of having
            // added them, so that one defaults ON; sharing location is a
            // separate, more sensitive disclosure and stays opt-in, matching
            // the server's own `shareLocation` default of false.
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--danger-deep)', cursor: 'pointer' }}>
                <input type="checkbox" checked={notifyContacts} onChange={(e) => setNotifyContacts(e.target.checked)} style={{ width: 15, height: 15 }} />
                Notify {contacts.length} emergency contact{contacts.length > 1 ? 's' : ''}
              </label>
              {notifyContacts ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--danger-deep)', cursor: 'pointer', marginLeft: 23 }}>
                  <input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} style={{ width: 15, height: 15 }} />
                  Include my last known location
                </label>
              ) : null}
            </div>
          ) : (
            <p className="foot" style={{ marginTop: 10 }}>
              No emergency contacts saved — nobody will be notified. <Link to="/settings" style={{ color: 'var(--danger-deep)' }}>Add contacts in Settings</Link>.
            </p>
          )}
          <HoldButton onComplete={confirm} disabled={busy} />
        </div>
      ) : null}

      {/*
       * The real action, not a simulated one. `dispatch.status` reaching
       * `dispatch_requested` (confirm-routing.ts) means the ambulance
       * outcome was just confirmed through the hold-and-release gate above —
       * but that itself is recorded as `simulated: true` on purpose, because
       * there is no ambulance-dispatch API behind it to call. The one real
       * action available is the phone: India's ambulance service is reached
       * by dialling 108, same as First Aid's own call banner, which is
       * exactly what this is. It stays on screen (not a one-shot toast)
       * because the automatic dial attempted in `confirm` above is only a
       * courtesy — some browsers block an unprompted `tel:` navigation, and
       * this is the fallback for those and for anyone who backed out of the
       * dialer.
       */}
      {summary?.dispatch.status === 'dispatch_requested' ? (
        <a href={`tel:${EMERGENCY_NUMBER}`} className="call-banner fade-up">
          <div className="call-phone-circle">
            <PhoneIcon />
          </div>
          <div style={{ flex: 'none' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 8.5, color: 'rgba(255,255,255,0.78)', letterSpacing: 1.2 }}>
              CALL NOW
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 34, color: '#fff', letterSpacing: -0.5, lineHeight: '38px', marginTop: 1 }}>
              {EMERGENCY_NUMBER}
            </div>
          </div>
          <div className="call-divider" />
          <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
            Ambulance requested. Call {EMERGENCY_NUMBER} now to speak to a real dispatcher — this app cannot dispatch one for you.
          </p>
        </a>
      ) : null}

      {/*
       * What actually happened to each notification, not just "it was
       * requested". `TWILIO_LIVE=false` is a genuine, deliberate safety
       * default (see twilio-notification-port.ts) — a `suppressed` status
       * here is the app working exactly as configured, not a failure, and
       * saying so plainly is what stops "did this actually send?" from
       * looking like the whole feature is broken.
       */}
      {notifications.length > 0 ? (
        <div className="glass card fade-up">
          <div className="label">Emergency contact notifications</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {notifications.map((n) => {
              const contact = contacts.find((c) => c.id === n.contactId);
              return (
                <div key={n.contactId} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small">{contact?.name ?? 'Contact'} · {n.channel}</span>
                  <span
                    className="foot"
                    style={{ color: n.status === 'failed' ? 'var(--danger-deep)' : n.status === 'suppressed' ? 'var(--warn-deep)' : 'var(--ok)' }}
                  >
                    {NOTIFY_STATUS_LABEL[n.status] ?? n.status}
                  </span>
                </div>
              );
            })}
          </div>
          {notifications.some((n) => n.status === 'suppressed') ? (
            <p className="foot" style={{ marginTop: 8 }}>
              "Not sent (dry run)" means this server is running with `TWILIO_LIVE=false` — messages are composed but
              never put on the wire. This is a deliberate rehearsal setting, not an error.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="fade-up" style={{ animationDelay: '100ms' }}>
        <h3 className="h3" style={{ marginBottom: 9 }}>
          What are you experiencing?
        </h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {QUICK_SELECT_OPTIONS.map((option) => (
            <button
              key={option.tag}
              type="button"
              className={`pill${selected.includes(option.tag) ? ' selected' : ''}${option.critical ? ' critical' : ''}`}
              onClick={() => setSelected((prev) => (prev.includes(option.tag) ? prev.filter((t) => t !== option.tag) : [...prev, option.tag]))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => void submitTags()} disabled={selected.length === 0 || busy}>
        {selected.length > 0 ? `Send ${selected.length} symptom${selected.length > 1 ? 's' : ''}` : 'Select what applies'}
      </button>

      <div className="fade-up" style={{ animationDelay: '140ms' }}>
        <h3 className="h3" style={{ marginBottom: 9 }}>
          Or describe it
        </h3>
        <textarea
          className="text-input"
          style={{ width: '100%', minHeight: 74, resize: 'vertical' }}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="e.g. I have a heavy feeling in my chest"
        />
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => void submitAnswer()} disabled={answer.trim().length === 0 || busy}>
          Send
        </button>
      </div>

      <HospitalsPanel />

      {error !== undefined ? (
        <div className="glass card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <p className="small" style={{ color: 'var(--danger-ink)' }}>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
