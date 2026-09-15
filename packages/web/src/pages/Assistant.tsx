import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseId, InjuryTracking } from '@triage/shared';
import {
  api,
  ApiError,
  resolveOwnerUid,
  type CaseSummary,
  type MedicineIdentification,
  type MedicineInfoSource,
  type TurnResponse,
} from '../api/client';
import { HoldButton } from '../components/HoldButton';
import { FloatingLines } from '../components/FloatingLines';
import { AssistantOrb } from '../components/AssistantOrb';
import { MedicineCard } from '../components/MedicineCard';
import { InjuryCard } from '../components/InjuryCard';
import {
  createSession,
  getActiveSessionId,
  getSession,
  listSessions,
  saveSession,
  setActiveSessionId,
  type ChatSession,
} from '../data/chatHistoryStore';
import { readImageFile } from '../data/imageInput';

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


/**
 * Every documented failure mode gets its own sentence. The one thing this must
 * never do is fail silently or blame the user for a server problem.
 */
function imageErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Something went wrong reading that photo. Try again, or describe what you can see instead.';
  }
  switch (err.code) {
    case 'network_unreachable':
      return 'I could not reach the server to analyse that photo. Check your connection and try again — First Aid still works offline.';
    case 'vision_unavailable':
      return 'Photo analysis is not switched on for this server right now. Tell me what you can see and I will carry on from there.';
    case 'classify_failed':
    case 'identify_failed':
      // The server now distinguishes "your photo was unreadable" from "the
      // server hit its Gemini quota" / "vision is misconfigured", and phrases
      // each one safely. Wrapping all three in "I could not read that image"
      // put the blame back on the user's camera for problems that were ours —
      // which is exactly the behaviour that made a quota failure look like a
      // bad photo in production. So the server's sentence is used verbatim.
      return err.message;
    case 'invalid_request':
      return 'That file did not come through as a usable image. Try a JPG or PNG photo.';
    default:
      return err.message;
  }
}

/**
 * A structured result rendered as a glass card inside the conversation. Stored
 * ON the message (and therefore in the persisted chat session) rather than in
 * separate state, so a scan survives leaving the screen, a browser refresh,
 * and reopening the conversation from History — exactly like the text around
 * it. Plain JSON by construction: no class instances, nothing that would fail
 * to round-trip through localStorage.
 */
type MessageCard =
  | { readonly kind: 'medicine'; readonly medicine: MedicineIdentification; readonly sources?: readonly MedicineInfoSource[] }
  | {
      readonly kind: 'injury';
      readonly injury: InjuryTracking;
      readonly riskTier?: string;
      readonly triageLevel?: string;
      readonly scoringSource?: string;
    };

interface Message {
  readonly id: string;
  readonly who: 'agent' | 'user';
  readonly text: string;
  readonly meta?: string;
  /** A user message can carry the photo thumbnail it was sent with. */
  readonly image?: string;
  readonly card?: MessageCard;
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
  const [inputFocused, setInputFocused] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // Messages already present when this component mounted (restored from
  // history) render instantly, no entrance animation — only messages that
  // arrive DURING this visit get the glass-emergence treatment. Reset
  // whenever the active session changes (switching via History), so a
  // freshly opened past conversation doesn't replay a "wall of messages
  // fading in at once."
  const seenCountRef = useRef(messages.length);

  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [showCameraChoice, setShowCameraChoice] = useState(false);
  /**
   * TWO inputs, not one. `capture="environment"` is what makes a phone open
   * the camera directly, but on a desktop browser it can suppress the normal
   * file chooser entirely — so "Take photo" uses the capture input and
   * "Choose photo" uses a plain one. Both are `<input type="file">`, which is
   * also what keeps the permission prompt correct: nothing is requested until
   * the user has pressed one of these, never on mount.
   */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    seenCountRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Persists on every change
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
    setDraftImage(null);
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
    setDraftImage(null);
    setShowHistory(false);
  }, []);

  const appendAgent = useCallback((text: string, meta?: string) => {
    setMessages((prev) => [...prev, { id: `a${Date.now()}${Math.random()}`, who: 'agent', text, ...(meta === undefined ? {} : { meta }) }]);
  }, []);

  const appendCard = useCallback((text: string, card: MessageCard) => {
    setMessages((prev) => [...prev, { id: `a${Date.now()}${Math.random()}`, who: 'agent', text, card }]);
  }, []);

  const openCase = useCallback(async (): Promise<CaseId> => {
    const ownerUid = resolveOwnerUid();
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

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Resetting the input here (not later) is what lets the user pick the SAME
    // file again after cancelling — an unchanged value fires no change event.
    e.target.value = '';
    setShowCameraChoice(false);
    if (!file) return;

    setImageError(undefined);
    void readImageFile(file).then((result) => {
      if (result.ok) setDraftImage(result.dataUrl);
      else setImageError(result.message);
    });
  };

  const send = useCallback(async () => {
    const text = draft.trim();
    const image = draftImage;
    if ((text.length === 0 && !image) || busy) return;
    
    setDraft('');
    setDraftImage(null);

    // --- Photo path ----------------------------------------------------------
    // One button, two destinations. The backend classifies first; a medicine
    // is answered there in full, while an INJURY is deliberately routed back
    // through the case/triage loop here so that vision stays an observation
    // and the deterministic scorer keeps sole ownership of the risk tier.
    if (image) {
      setMessages((prev) => [
        ...prev,
        { id: `u${Date.now()}`, who: 'user', text: text.length > 0 ? text : 'Sent a photo', image },
      ]);
      setBusy(true);
      try {
        const analysis = await api.analyzeImage(image);

        if (analysis.kind === 'medicine') {
          appendCard(
            analysis.narrative ??
              (analysis.medicine.productName !== undefined
                ? `Here is what I could read from that pack.`
                : `I could not confirm which medicine that is.`),
            { kind: 'medicine', medicine: analysis.medicine, ...(analysis.sources !== undefined ? { sources: analysis.sources } : {}) },
          );
          return;
        }

        if (analysis.kind === 'other') {
          appendAgent(
            `That does not look like a medicine pack or an injury — ${analysis.classification.reason} Try a photo of the medicine packaging, or of the injured area itself.`,
          );
          return;
        }

        // Injury. A case is required: the photo becomes evidence on it, and
        // everything downstream (question selection, scoring) is the same
        // path a typed answer takes.
        const id = caseId ?? (await openCase());
        if (caseId === undefined) {
          appendAgent(
            'That looks like an injury, so I am opening a case — the photo becomes part of it, and everything from here is tracked and scored properly.',
            'Case opened · photo added as an observation',
          );
        }
        const turn = await api.submitPhoto(id, image);
        setSummary(turn);
        if (turn.injury !== undefined) {
          appendCard('Here is what the photo showed.', {
            kind: 'injury',
            injury: turn.injury,
            ...(turn.riskTier !== undefined ? { riskTier: turn.riskTier } : {}),
            ...(turn.triageLevel !== undefined ? { triageLevel: turn.triageLevel } : {}),
            ...(turn.scoringSource !== undefined ? { scoringSource: turn.scoringSource } : {}),
          });
        } else {
          appendAgent(
            'I could not read that photo clearly enough to use it. Describe what you can see instead — the assessment does not depend on the image.',
          );
        }
        // The adaptive next question, chosen from the evidence the photo just
        // added — not a fixed follow-up script.
        if (turn.turn.question !== undefined) {
          appendAgent(
            turn.turn.question.text,
            turn.turn.question.hardToDeflect ? 'I need a clear answer on this' : undefined,
          );
        }
        if (turn.turn.adaptation !== undefined) {
          appendAgent(turn.turn.adaptation.explanation, `Re-planned · ${turn.turn.adaptation.trigger.replace(/_/g, ' ')}`);
        }
      } catch (err) {
        appendAgent(imageErrorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Normal text chat
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
  }, [appendAgent, applyTurn, busy, caseId, draft, draftImage, messages, openCase]);

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

  // The bottom inset clears the composer AND the nav beneath it, so the last
  // message can always be scrolled clear of both.
  return (
    <div className="page" style={{ paddingBottom: 'calc(178px + env(safe-area-inset-bottom, 0px))', position: 'relative' }}>
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
        {messages.map((m, i) => (
          <div key={m.id} className={i >= seenCountRef.current ? 'msg-in' : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: m.who === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.image !== undefined ? (
              <img
                src={m.image}
                alt="Photo you sent"
                style={{ maxWidth: '58%', borderRadius: 14, marginBottom: 6, border: '1px solid var(--glass-border)' }}
              />
            ) : null}
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
                whiteSpace: 'pre-wrap'
              }}
            >
              {m.text}
            </div>
            {m.meta !== undefined ? <div className="foot" style={{ marginTop: 3 }}>{m.meta}</div> : null}
            {/* Structured results render as their own glass card beneath the
                sentence that introduces them — never as markdown in a bubble. */}
            {m.card?.kind === 'medicine' ? (
              <div style={{ width: '100%', marginTop: 8 }}>
                <MedicineCard medicine={m.card.medicine} sources={m.card.sources} />
              </div>
            ) : null}
            {m.card?.kind === 'injury' ? (
              <div style={{ width: '100%', marginTop: 8 }}>
                <InjuryCard
                  injury={m.card.injury}
                  riskTier={m.card.riskTier}
                  triageLevel={m.card.triageLevel}
                  scoringSource={m.card.scoringSource}
                />
              </div>
            ) : null}
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
          // Clears the floating nav (72px tall, 18px off the bottom) plus the
          // device inset, so the composer never sits on top of it.
          bottom: 'calc(98px + env(safe-area-inset-bottom, 0px))',
          maxWidth: 480,
          margin: '0 auto',
          padding: '0 20px',
          gap: 8,
          zIndex: 2,
          alignItems: 'flex-end'
        }}
      >
        {/* Action sheet. Shown only after the camera button is pressed —
            nothing touches the camera or the file system before that. */}
        {showCameraChoice ? (
          <div
            className="glass card card-pop"
            style={{ position: 'absolute', left: 20, right: 20, bottom: 68, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3 }}
          >
            <div className="label" style={{ padding: '2px 6px 4px' }}>Add a photo</div>
            <button type="button" className="btn btn-secondary" onClick={() => cameraInputRef.current?.click()}>
              Take photo
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => libraryInputRef.current?.click()}>
              Choose photo
            </button>
            <button
              type="button"
              onClick={() => setShowCameraChoice(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, padding: 8, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <p className="foot" style={{ padding: '0 6px 2px' }}>
              A medicine pack, or the injured area — VITALIS works out which it is.
            </p>
          </div>
        ) : null}

        <div className={`assistant-input-wrap${inputFocused ? ' focused' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.9)' }}>
          {imageError !== undefined && (
            <div style={{ padding: '10px 14px 0' }}>
              <p className="foot" style={{ color: 'var(--danger-deep)', margin: 0 }}>{imageError}</p>
            </div>
          )}
          {draftImage && (
            <div style={{ position: 'relative', padding: 12, paddingBottom: 0 }}>
              <img src={draftImage} alt="Preview of the photo to analyse" style={{ height: 60, borderRadius: 12, objectFit: 'cover' }} />
              <button
                type="button"
                onClick={() => setDraftImage(null)}
                aria-label="Remove photo"
                style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 12, width: 24, height: 24, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setImageError(undefined);
                setShowCameraChoice((open) => !open);
              }}
              style={{ background: 'none', border: 'none', padding: '12px 14px', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Add a photo"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21.44 7.11L19.5 4.54a1.86 1.86 0 00-1.49-.75H5.98c-.59 0-1.12.28-1.48.75L2.55 7.11a1.88 1.88 0 00-.39 1.15v10.1c0 1.05.85 1.9 1.9 1.9h15.86c1.05 0 1.9-.85 1.9-1.9V8.26c0-.43-.14-.84-.38-1.15z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 16.5a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              onChange={handleImageCapture}
              style={{ display: 'none' }}
            />
            <input type="file" accept="image/*" ref={libraryInputRef} onChange={handleImageCapture} style={{ display: 'none' }} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              // Shortened deliberately: the old copy needed ~237px and the
              // field is ~212px at a 360px viewport once the camera button and
              // send button have taken their share, so it was always clipped
              // mid-word. This fits with room to spare at 360px.
              placeholder="Ask Vitalis anything…"
              className="text-input"
              // `minWidth: 0` is what actually lets this shrink. A flex item
              // defaults to `min-width: auto`, i.e. it refuses to go narrower
              // than its content, which is how a long value pushes the send
              // button off-screen at 360px instead of scrolling inside itself.
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: '13px 14px 13px 0', outline: 'none' }}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary send-btn" disabled={busy} style={{ borderRadius: '50%', width: 46, height: 46, padding: 0, flexShrink: 0, marginBottom: 2 }}>
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
