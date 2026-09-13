import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseId } from '@triage/shared';
import { api, ApiError, resolveOwnerUid, type CaseSummary, type TurnResponse } from '../api/client';
import { HoldButton } from '../components/HoldButton';
import { FloatingLines } from '../components/FloatingLines';
import { AssistantOrb } from '../components/AssistantOrb';
import {
  createSession,
  getActiveSessionId,
  getSession,
  listSessions,
  saveSession,
  setActiveSessionId,
  type ChatSession,
} from '../data/chatHistoryStore';

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

/** Loads the active session (or creates one) exactly once per mount, never on
 * every render — a lazy useState initializer, not an effect, so it can never
 * fire a second time and silently replace live state. */
function loadInitialSession(): ChatSession {
  const activeId = getActiveSessionId();
  const active = activeId === undefined ? undefined : getSession(activeId);
  return active ?? createSession();
}

export function Assistant() {
  const [session, setSession] = useState<ChatSession>(loadInitialSession);
  const [messages, setMessages] = useState<readonly Message[]>(session.messages.length > 0 ? session.messages : [OPENING]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState<CaseId | undefined>(session.caseId as CaseId | undefined);
  const [summary, setSummary] = useState<CaseSummary | undefined>(session.summary as CaseSummary | undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<readonly ChatSession[]>([]);
  const threadEnd = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persists on every change — this, not an unmount handler, is what makes
  // "leave normally, come back" and "refresh the browser" both work: the
  // component can be torn down at any point (navigation, reload) with no
  // cleanup step, because the latest state was already written.
  useEffect(() => {
    saveSession({ id: session.id, messages, caseId, summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, messages, caseId, summary]);

  const startNewChat = useCallback(() => {
    const fresh = createSession();
    setSession(fresh);
    setMessages([OPENING]);
    setCaseId(undefined);
    setSummary(undefined);
    setDraft('');
    setShowHistory(false);
  }, []);

  const openHistory = useCallback(() => {
    setHistoryList(listSessions());
    setShowHistory(true);
  }, []);

  const openSession = useCallback((id: string) => {
    const target = getSession(id);
    if (target === undefined) return;
    setActiveSessionId(id);
    setSession(target);
    setMessages(target.messages.length > 0 ? target.messages : [OPENING]);
    setCaseId(target.caseId as CaseId | undefined);
    setSummary(target.summary as CaseSummary | undefined);
    setShowHistory(false);
  }, []);

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
    <div className="page" style={{ paddingBottom: 140, position: 'relative' }}>
      <FloatingLines
        enabledWaves={['top', 'middle', 'bottom']}
        lineCount={[10, 15, 20]}
        lineDistance={[8, 6, 4]}
        bendRadius={5.0}
        bendStrength={-0.5}
        interactive
        parallax
      />
      <div className="row fade-up" style={{ justifyContent: 'space-between', position: 'relative' }}>
        <h1 className="h1">Assistant</h1>
        <div className="row" style={{ gap: 8 }}>
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
          <button
            onClick={openHistory}
            className="pill"
            style={{ background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
          >
            History
          </button>
          <button
            onClick={startNewChat}
            className="pill"
            style={{ background: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}
          >
            New chat
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="glass card fade-up" style={{ position: 'relative', maxHeight: 260, overflowY: 'auto' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="label">Previous conversations</div>
            <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
              Close
            </button>
          </div>
          {historyList.length === 0 ? (
            <p className="small">No previous conversations yet.</p>
          ) : (
            historyList.map((s, i) => (
              <button
                key={s.id}
                onClick={() => openSession(s.id)}
                className="row"
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: 'none',
                  borderTop: i > 0 ? '1px solid var(--divider)' : 'none',
                  background: s.id === session.id ? 'rgba(23,105,232,0.06)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{s.title}</span>
                <span className="small">{new Date(s.updatedAt).toLocaleDateString()}</span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {messages.length <= 1 ? (
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <AssistantOrb />
          <div className="label fade-up" style={{ animationDelay: '700ms', letterSpacing: '0.15em' }}>
            VITALIS AI ASSISTANT
          </div>
          <p className="fade-up" style={{ animationDelay: '780ms', fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--ink)', marginTop: 6 }}>
            How can I
            <br />
            help you today?
          </p>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
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
        {busy ? (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div className="glass card-pop" style={{ padding: '11px 16px', borderRadius: 16 }}>
              <span className="glass-loading" style={{ color: 'var(--primary)' }}>
                <span className="dot-beat" />
                <span className="dot-beat" />
                <span className="dot-beat" />
              </span>
            </div>
          </div>
        ) : null}
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
          zIndex: 2,
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Vitalis anything about your health…"
          className="text-input glass"
          style={{ flex: 1, borderRadius: 999, padding: '13px 17px' }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ borderRadius: '50%', width: 46, height: 46, padding: 0 }}>
          {busy ? (
            <span className="glass-loading" style={{ color: '#fff' }}>
              <span className="dot-beat" />
              <span className="dot-beat" />
              <span className="dot-beat" />
            </span>
          ) : (
            '↑'
          )}
        </button>
      </form>
    </div>
  );
}

function tierColor(tier: string): string {
  return { green: '#15803D', yellow: '#D97706', orange: '#EA580C', red: '#DC2626' }[tier] ?? '#64748B';
}
