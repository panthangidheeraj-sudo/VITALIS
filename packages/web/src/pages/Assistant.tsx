import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseId } from '@triage/shared';
import { api, ApiError, resolveOwnerUid, type CaseSummary, type TurnResponse } from '../api/client';
import { HoldButton } from '../components/HoldButton';

/**
 * Ported from packages/mobile/src/screens/AssistantScreen.tsx — same rule:
 * `needsTriage()` is a LOCAL keyword gate, not a model judgement, and it is
 * the only thing that decides whether a message escalates to a real case.
 * Below that gate, general chat goes to the same `/assistant/chat` the
 * server exposes for the mobile app — no separate/invented API.
 */
const ESCALATE_TERMS = [
  'chest', 'heart attack', 'breath', 'breathing', 'choking', 'bleeding', 'blood',
  'unconscious', 'faint', 'fainted', 'collapse', 'collapsed', 'seizure', 'fit',
  'stroke', 'paralys', 'numb', 'slurred', 'overdose', 'poison', 'burn', 'burnt',
  'broken', 'fracture', 'head injury', 'suicid', 'kill myself', 'emergency',
  'ambulance', 'severe', 'worst pain', 'cannot move', "can't move", 'vomiting blood',
];

function needsTriage(text: string): boolean {
  const lower = text.toLowerCase();
  return ESCALATE_TERMS.some((term) => lower.includes(term));
}

interface Message {
  readonly id: string;
  readonly who: 'agent' | 'user';
  readonly text: string;
  readonly meta?: string;
}

const OPENING: Message = {
  id: 'opening',
  who: 'agent',
  text: 'Ask me anything about your health, your readings, or your medication. If what you describe sounds urgent I will stop and move you to the triage interview instead — that is deliberate.',
};

export function Assistant() {
  const [messages, setMessages] = useState<readonly Message[]>([OPENING]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState<CaseId | undefined>(undefined);
  const [summary, setSummary] = useState<CaseSummary | undefined>(undefined);
  const threadEnd = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const appendAgent = useCallback((text: string, meta?: string) => {
    setMessages((prev) => [...prev, { id: `a${Date.now()}${Math.random()}`, who: 'agent', text, ...(meta === undefined ? {} : { meta }) }]);
  }, []);

  const openCase = useCallback(async (): Promise<CaseId> => {
    const ownerUid = resolveOwnerUid();
    // No profile/demographics UI in this pass — a neutral technical default,
    // never shown as though it were the user's real data.
    const created = await api.createCase({ ownerUid, ageYears: 30, sex: 'female' });
    setCaseId(created.caseId);
    setSummary(created);
    return created.caseId;
  }, []);

  const applyTurn = useCallback((result: TurnResponse) => {
    setSummary(result);
    if (result.turn.question !== undefined) {
      appendAgent(result.turn.question.text, result.turn.question.hardToDeflect ? 'I need a clear answer on this' : undefined);
    }
    if (result.turn.adaptation !== undefined) {
      appendAgent(result.turn.adaptation.explanation, `Re-planned · ${result.turn.adaptation.trigger.replace(/_/g, ' ')}`);
    }
    if (result.turn.question === undefined && result.turn.adaptation === undefined) {
      appendAgent('Noted. Keep going, or tell me if anything changes.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, who: 'user', text }]);

    if (caseId !== undefined) {
      setBusy(true);
      try {
        applyTurn(await api.submitText(caseId, text));
      } catch (err) {
        appendAgent(err instanceof ApiError ? err.message : 'That did not reach your case. Try again.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const escalate = needsTriage(text);
    if (!escalate) {
      setBusy(true);
      try {
        const history = messages.slice(-8).map((m) => ({ role: m.who === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
        const result = await api.assistantChat(text, history);
        appendAgent(result.reply, result.citation?.title === undefined ? undefined : `Source: ${result.citation.title}`);
      } catch (err) {
        appendAgent(err instanceof ApiError ? err.message : 'Could not reach the assistant. Try again in a moment.');
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    appendAgent(
      'That needs proper tracking, not a chat answer — I am opening a case and everything from here becomes part of it.',
      'Case opened · scored by the same engine as full triage',
    );
    try {
      const id = await openCase();
      applyTurn(await api.submitText(id, text));
    } catch (err) {
      appendAgent(err instanceof ApiError ? err.message : 'Could not open a case. Try the Emergency screen instead.');
    } finally {
      setBusy(false);
    }
  }, [appendAgent, applyTurn, busy, caseId, draft, messages, openCase]);

  const confirm = useCallback(
    async (heldMs: number) => {
      if (caseId === undefined) return;
      setBusy(true);
      try {
        await api.confirm(caseId, heldMs);
        navigate(`/emergency?case=${caseId}`);
      } catch (err) {
        appendAgent(err instanceof ApiError ? err.message : 'Could not confirm. Try the Emergency screen instead.');
      } finally {
        setBusy(false);
      }
    },
    [appendAgent, caseId, navigate],
  );

  const awaitingConfirmation = summary?.status === 'awaiting_confirmation' && summary.routing !== undefined;

  return (
    <div className="page" style={{ paddingBottom: 140 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">Assistant</h1>
        {summary !== undefined ? (
          <span
            className="pill"
            style={{
              background: tierColor(summary.riskTier),
              color: '#fff',
              borderColor: 'transparent',
              cursor: 'default',
            }}
          >
            {summary.riskTier.toUpperCase()}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.who === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              className={m.who === 'agent' ? 'glass' : undefined}
              style={{
                maxWidth: '82%',
                padding: '11px 14px',
                borderRadius: 16,
                fontSize: 13.5,
                lineHeight: 1.5,
                background: m.who === 'user' ? 'var(--brand)' : undefined,
                color: m.who === 'user' ? '#fff' : 'var(--ink)',
              }}
            >
              {m.text}
            </div>
            {m.meta !== undefined ? <div className="foot" style={{ marginTop: 3 }}>{m.meta}</div> : null}
          </div>
        ))}
        <div ref={threadEnd} />
      </div>

      {awaitingConfirmation && summary?.routing !== undefined ? (
        <div className="glass card" style={{ border: '2px solid rgba(220,38,38,0.5)' }}>
          <div className="label" style={{ color: 'var(--danger-deep)' }}>
            Recommended outcome
          </div>
          <div className="h2" style={{ marginTop: 6, color: 'var(--danger-deep)', textTransform: 'capitalize' }}>
            {summary.routing.outcome.replace(/_/g, ' ')}
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            {summary.routing.gate.consequenceStatement}
          </p>
          <HoldButton onComplete={confirm} disabled={busy} />
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="row"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 92,
          maxWidth: 480,
          margin: '0 auto',
          padding: '0 20px',
          gap: 8,
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Vitalis anything about your health…"
          className="text-input glass"
          style={{ flex: 1, borderRadius: 999, padding: '13px 17px' }}
        />
        <button type="submit" className="btn btn-primary" style={{ borderRadius: '50%', width: 46, height: 46, padding: 0 }}>
          ↑
        </button>
      </form>
    </div>
  );
}

function tierColor(tier: string): string {
  return { green: '#15803D', yellow: '#D97706', orange: '#EA580C', red: '#DC2626' }[tier] ?? '#64748B';
}
