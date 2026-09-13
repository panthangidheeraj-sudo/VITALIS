import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BiologicalSex, CaseId } from '@triage/shared';
import { api, ApiError, resolveOwnerUid, type CaseSummary, type TurnResponse } from '../api/client';
import { QUICK_SELECT_OPTIONS } from '../data/quickSelectTags';
import { HoldButton } from '../components/HoldButton';
import { HospitalsPanel } from '../components/HospitalsPanel';

const TIER_COLOR: Record<string, string> = { green: '#15803D', yellow: '#D97706', orange: '#EA580C', red: '#DC2626' };
const TIER_LABEL: Record<string, string> = { green: 'LOW RISK', yellow: 'ELEVATED', orange: 'URGENT', red: 'CRITICAL' };

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

  const [caseId, setCaseId] = useState<CaseId | undefined>(openCaseId ?? undefined);
  const [summary, setSummary] = useState<CaseSummary | undefined>(undefined);
  const [lastTurn, setLastTurn] = useState<TurnResponse['turn'] | undefined>(undefined);
  const [ageYears, setAgeYears] = useState('30');
  const [sex, setSex] = useState<BiologicalSex>('female');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
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
      setBusy(true);
      setError(undefined);
      try {
        setSummary(await api.confirm(caseId, heldMs));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not confirm.');
      } finally {
        setBusy(false);
      }
    },
    [caseId],
  );

  if (caseId === undefined) {
    return (
      <div className="page">
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
      <h1 className="h1">Emergency triage</h1>

      <div className="glass glass-lift" style={{ borderRadius: 20, overflow: 'hidden' }}>
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
        <div className="glass card" style={{ border: '2px solid rgba(220,38,38,0.5)' }}>
          <div className="label" style={{ color: 'var(--danger-deep)' }}>
            Recommended outcome
          </div>
          <div className="h2" style={{ marginTop: 6, color: 'var(--danger-deep)', textTransform: 'capitalize' }}>
            {summary.routing.outcome.replace(/_/g, ' ')}
          </div>
          <p className="small" style={{ marginTop: 6 }}>{summary.routing.gate.consequenceStatement}</p>
          <HoldButton onComplete={confirm} disabled={busy} />
        </div>
      ) : null}

      <div>
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

      <div>
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
