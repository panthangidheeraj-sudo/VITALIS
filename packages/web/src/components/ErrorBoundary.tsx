import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render-time throw anywhere below it.
 *
 * WHY THIS EXISTS. React's behaviour on an uncaught render error is to unmount
 * the whole tree — the user gets a white screen, with no message, no way back,
 * and nothing on it to say the app has failed rather than is loading. This app
 * has already shipped that exact failure once (Firebase threw during module
 * evaluation and the boot placeholder sat on screen permanently), which is why
 * index.html carries a boot watchdog.
 *
 * The watchdog and this boundary cover DIFFERENT halves of the same problem,
 * and neither substitutes for the other:
 *   - the watchdog fires when the bundle never evaluates, so React never mounts
 *     and the placeholder is still in the DOM;
 *   - this fires when React DID mount — the placeholder is long gone — and a
 *     component threw afterwards. Nothing else in the app covers that.
 *
 * The emergency line is not boilerplate. A triage app that has just failed must
 * not leave someone waiting on it, so the fallback says plainly what to do
 * instead of retrying.
 */

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged, never rendered: a React error message can carry props values,
    // and those can be whatever the user typed into the assistant.
    console.error('[vitalis] render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    // Deliberately plain inline styles and no app components: the stylesheet
    // may be fine, but whatever just threw might also be what this would
    // otherwise depend on. A fallback that can itself fail is not a fallback.
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#EEF4FD',
          textAlign: 'center',
        }}
      >
        <p style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: 15, color: '#142744', margin: '0 0 6px' }}>
          Something went wrong
        </p>
        <p
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: '#7185A3',
            margin: 0,
            maxWidth: 300,
          }}
        >
          VITALIS hit an unexpected error and stopped. Reload to try again — in an emergency, call your local emergency
          number directly rather than waiting.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            color: '#fff',
            background: '#1769E8',
            border: 'none',
            borderRadius: 999,
            padding: '11px 22px',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
