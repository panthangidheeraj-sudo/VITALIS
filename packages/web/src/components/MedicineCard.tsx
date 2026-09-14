import type { MedicineIdentification, MedicineInfoSource } from '../api/client';

/**
 * The medicine result, as a VITALIS glass card rather than a paragraph of
 * chat text (the previous version emitted raw `**markdown**` into a plain
 * text bubble, which rendered as literal asterisks).
 *
 * TWO THINGS THIS CARD IS CAREFUL ABOUT:
 *   1. A missing field is stated, never omitted or filled in. "Expiry date not
 *      clearly visible" is rendered in the same slot a real date would be, so
 *      the absence is impossible to miss.
 *   2. "Commonly used for" carries its provenance. When the text came from a
 *      trusted source it is cited by name; when it came from the vision model
 *      it says so, so the two can never look identical.
 */

const CONFIDENCE_BANDS = [
  { min: 0.75, label: 'High', color: 'var(--ok)', wash: 'rgba(21,128,61,0.12)' },
  { min: 0.45, label: 'Medium', color: 'var(--warn)', wash: 'rgba(217,119,6,0.14)' },
  { min: 0, label: 'Low', color: 'var(--danger-deep)', wash: 'rgba(220,38,38,0.1)' },
] as const;

function band(confidence: number) {
  return CONFIDENCE_BANDS.find((b) => confidence >= b.min) ?? CONFIDENCE_BANDS[2];
}

export function MedicineCard({
  medicine,
  sources = [],
}: {
  readonly medicine: MedicineIdentification;
  readonly sources?: readonly MedicineInfoSource[];
}) {
  // No product name means no identification — and then nothing else on the
  // card can be trusted either, so the card refuses to pretend otherwise.
  if (medicine.productName === undefined) {
    return (
      <div className="glass card glass-emerge" style={{ borderLeft: '3px solid var(--warn)' }}>
        <div className="label" style={{ color: 'var(--warn)' }}>Medicine scan</div>
        <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginTop: 8 }}>
          Medicine identity could not be confirmed.
        </p>
        <p className="small" style={{ marginTop: 6 }}>{medicine.notes}</p>
        <p className="foot" style={{ marginTop: 8 }}>
          Try again with the front of the pack in focus and good light, or read the name from the package directly.
        </p>
      </div>
    );
  }

  const conf = band(medicine.confidence);
  const uses = medicine.uses ?? medicine.usesAndBenefits;
  const fromModel = medicine.usesSource === 'model' || (medicine.uses === undefined && medicine.usesAndBenefits !== undefined);

  return (
    <div className="glass card glass-emerge" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="label">Medicine identified</div>
        <span
          className="pill"
          style={{ fontSize: 10, padding: '3px 9px', background: conf.wash, color: conf.color, border: 'none', cursor: 'default' }}
        >
          {conf.label} confidence
        </span>
      </div>

      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 19, color: 'var(--ink)', letterSpacing: -0.3, marginTop: 4 }}>
        {medicine.productName}
        {medicine.strength !== undefined ? <span style={{ fontWeight: 700, color: 'var(--muted)' }}>{` ${medicine.strength}`}</span> : null}
      </div>
      {medicine.genericName !== undefined && medicine.genericName.toLowerCase() !== medicine.productName.toLowerCase() ? (
        <div className="small" style={{ marginTop: 1 }}>{medicine.genericName}</div>
      ) : null}

      {uses !== undefined ? (
        <Section title="Commonly used for">
          <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>{uses}</p>
          <p className="foot" style={{ marginTop: 6 }}>
            {fromModel
              ? 'General information from VITALIS’s own model — no matching NIH/NLM page was found for this name. Verify with a pharmacist.'
              : 'From MedlinePlus (NIH/NLM).'}
          </p>
        </Section>
      ) : null}

      <Field
        label="Expiry"
        value={medicine.expiryDateText}
        missing={
          medicine.expiryAmbiguous === true
            ? 'Several dates are printed — please check which is the expiry on the pack.'
            : 'Not clearly visible — please verify on the package.'
        }
      />
      {medicine.dosageForm !== undefined ? <Field label="Form" value={medicine.dosageForm} /> : null}
      {medicine.manufacturer !== undefined ? <Field label="Manufacturer" value={medicine.manufacturer} /> : null}

      {medicine.cautions !== undefined ? (
        <Section title="Cautions">
          <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>{medicine.cautions}</p>
        </Section>
      ) : null}

      {sources.length > 0 ? (
        <Section title="Sources">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sources.map((s) => (
              <a
                key={`${s.provider}-${s.title}`}
                href={s.url ?? '#'}
                target={s.url === undefined ? undefined : '_blank'}
                rel="noreferrer"
                className="pill"
                style={{ fontSize: 10.5, padding: '4px 10px', textDecoration: 'none', cursor: s.url === undefined ? 'default' : 'pointer' }}
                onClick={(e) => {
                  if (s.url === undefined) e.preventDefault();
                }}
              >
                {s.provider === 'dailymed' ? 'DailyMed label' : s.provider === 'rxnorm' ? 'RxNorm' : s.title}
              </a>
            ))}
          </div>
        </Section>
      ) : null}

      <p className="foot" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--divider)' }}>
        {medicine.usesCaveat ??
          'Information only — not advice about your own dose. Drug interactions are not checked.'}
      </p>
      {medicine.notes.length > 0 ? <p className="foot" style={{ marginTop: 4 }}>{medicine.notes}</p> : null}
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
      <div className="label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

/** A field whose ABSENCE is rendered as explicitly as its presence. */
function Field({ label, value, missing }: { readonly label: string; readonly value?: string; readonly missing?: string }) {
  if (value === undefined && missing === undefined) return null;
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '9px 0', borderTop: '1px solid var(--divider)', marginTop: 2 }}>
      <span className="small" style={{ flex: 'none' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: value === undefined ? 500 : 700,
          fontSize: value === undefined ? 11.5 : 13,
          color: value === undefined ? 'var(--danger-deep)' : 'var(--ink)',
          textAlign: 'right',
          lineHeight: 1.4,
        }}
      >
        {value ?? missing}
      </span>
    </div>
  );
}
