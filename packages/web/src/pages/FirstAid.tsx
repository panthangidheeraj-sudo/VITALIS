import { useState } from 'react';
import { EMERGENCY_NUMBER, FIRST_AID_DISCLAIMER, FIRST_AID_TOPICS } from '../data/firstAidContent';

/** Ported from packages/mobile/src/screens/FirstAidScreen.tsx — static
 * content, works with no network (nothing here calls the API). */
export function FirstAid() {
  const [openId, setOpenId] = useState<string>(FIRST_AID_TOPICS[0]?.id ?? '');

  return (
    <div className="page">
      <h1 className="h1">First aid</h1>
      <p className="body-text">General guidance while waiting for help. Works with no signal.</p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {FIRST_AID_TOPICS.map((topic) => (
          <button
            key={topic.id}
            className={`pill${openId === topic.id ? ' selected' : ''}`}
            onClick={() => setOpenId(topic.id)}
          >
            {topic.title}
          </button>
        ))}
      </div>

      {FIRST_AID_TOPICS.filter((t) => t.id === openId).map((topic) => (
        <div key={topic.id} className="glass card">
          <div className="label">When to use this</div>
          <p className="body-text" style={{ marginTop: 6 }}>{topic.whenToUse}</p>
          {topic.callEmergencyFirst ? (
            <p className="small" style={{ marginTop: 8, color: 'var(--danger-deep)', fontWeight: 600 }}>
              Call {EMERGENCY_NUMBER} first, or have someone else call while you start.
            </p>
          ) : null}
          <ol style={{ marginTop: 14, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topic.steps.map((step) => (
              <li key={step.n} className="body-text">
                {step.text}
              </li>
            ))}
          </ol>
        </div>
      ))}

      <p className="foot">{FIRST_AID_DISCLAIMER}</p>
    </div>
  );
}
