import type { InjuryTracking } from '@triage/shared';
import { severityLabel } from '@triage/shared';

/**
 * Injury photo result. The layout itself enforces the architectural boundary:
 * the top half is what the PHOTO showed (observations, an appearance grade,
 * a trend), the bottom half is what the DETERMINISTIC SCORER concluded
 * (risk tier), and the card says in as many words that the second was not
 * decided by the first.
 *
 * Trend is only ever rendered with a direction the comparison actually
 * supports — `unknown` shows as "Not enough to compare", never as an arrow.
 */

const TREND_UI = {
  worsening: { glyph: '↑', label: 'Worsening', color: 'var(--danger-deep)', wash: 'rgba(220,38,38,0.1)' },
  stable: { glyph: '→', label: 'Stable', color: 'var(--muted)', wash: 'rgba(113,133,163,0.12)' },
  improving: { glyph: '↓', label: 'Improving', color: 'var(--ok)', wash: 'rgba(21,128,61,0.12)' },
  unknown: { glyph: '?', label: 'Not enough to compare', color: 'var(--muted)', wash: 'rgba(113,133,163,0.12)' },
} as const;

const SEVERITY_COLOR = {
  mild: 'var(--ok)',
  moderate: 'var(--warn)',
  severe: 'var(--danger-deep)',
  unable_to_assess: 'var(--muted)',
} as const;

export function InjuryCard({
  injury,
  riskTier,
  triageLevel,
  scoringSource,
}: {
  readonly injury: InjuryTracking;
  readonly riskTier?: string;
  readonly triageLevel?: string;
  readonly scoringSource?: string;
}) {
  const latest = injury.observations[injury.observations.length - 1];
  if (latest === undefined) return null;

  const trend = TREND_UI[injury.currentTrend];
  const signs = latest.visibleSigns.filter((s) => s !== 'none_visible');

  return (
    <div className="glass card glass-emerge" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="label">Injury photo · observation</div>
        <span
          className="pill"
          style={{ fontSize: 10, padding: '3px 9px', background: trend.wash, color: trend.color, border: 'none', cursor: 'default' }}
        >
          {trend.glyph} {trend.label}
        </span>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 800,
          fontSize: 16,
          letterSpacing: -0.2,
          color: SEVERITY_COLOR[latest.severity],
          marginTop: 6,
        }}
      >
        {severityLabel(latest.severity)}
      </div>

      <p className="small" style={{ marginTop: 6, lineHeight: 1.55 }}>{latest.description}</p>

      {signs.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {signs.map((sign) => (
            <span key={sign} className="pill" style={{ fontSize: 10.5, padding: '4px 10px', cursor: 'default' }}>
              {sign.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      ) : null}

      {latest.trendDetail !== undefined ? (
        <p className="foot" style={{ marginTop: 10 }}>{latest.trendDetail}</p>
      ) : null}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--divider)' }}>
        <span className="foot">Photo clarity</span>
        <span className="foot">{Math.round(latest.imageQuality * 100)}%</span>
      </div>
      {injury.observations.length > 1 ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="foot">Photos of this injury</span>
          <span className="foot">{injury.observations.length}</span>
        </div>
      ) : null}

      {riskTier !== undefined ? (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
          <div className="label" style={{ marginBottom: 6 }}>Clinical risk · scoring engine</div>
          <div className="row" style={{ gap: 8 }}>
            <span
              className="pill"
              style={{
                fontSize: 10.5,
                padding: '4px 11px',
                background: tierWash(riskTier),
                color: tierColor(riskTier),
                border: 'none',
                cursor: 'default',
                fontWeight: 700,
              }}
            >
              {riskTier.toUpperCase()}
            </span>
            {triageLevel !== undefined ? <span className="small">{triageLevel.replace(/_/g, ' ')}</span> : null}
          </div>
          {/* The sentence the whole architecture exists to be able to say
              truthfully — see the route comment on /assistant/image. */}
          <p className="foot" style={{ marginTop: 8 }}>
            The photo contributed an observation only. This tier was set by the deterministic scoring engine
            {scoringSource !== undefined ? ` (${scoringSource.replace(/_/g, ' ')})` : ''} from all evidence on the case, not by
            the image model.
          </p>
        </div>
      ) : null}

      <p className="foot" style={{ marginTop: 8 }}>
        A photo cannot rule anything out. If this is bleeding heavily, deep, or getting worse, call for help rather than
        waiting.
      </p>
    </div>
  );
}

function tierColor(tier: string): string {
  return { green: '#15803D', yellow: '#8A5A00', orange: '#B3460B', red: '#B3261E' }[tier] ?? 'var(--muted)';
}

function tierWash(tier: string): string {
  return (
    { green: 'rgba(21,128,61,0.12)', yellow: 'rgba(217,119,6,0.16)', orange: 'rgba(234,88,12,0.16)', red: 'rgba(220,38,38,0.12)' }[
      tier
    ] ?? 'rgba(113,133,163,0.12)'
  );
}
