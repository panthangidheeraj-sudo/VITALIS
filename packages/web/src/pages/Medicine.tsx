import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type MedicineIdentification } from '../api/client';
import { CameraIcon } from '../components/icons';

/**
 * Camera -> medicine identification (Home's "Medicine scanner" tile).
 *
 * The photo never touches anything but this page and the backend's
 * `/medications/identify` route — no Gemini key, no direct Gemini call, no
 * second AI pipeline here. See gemini-medicine-vision.ts's header for the
 * safety contract this UI has to respect: a missing/unclear field is
 * rendered as "Not clearly visible", never guessed at or left implying a
 * confident answer.
 */
export function Medicine() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'reading' | 'done' | 'error' | 'unavailable'>('idle');
  const [result, setResult] = useState<MedicineIdentification | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : undefined;
      if (dataUrl === undefined) return;
      setPhoto(dataUrl);
      setResult(undefined);
      setErrorMessage(undefined);
      setStatus('reading');
      api
        .identifyMedicine(dataUrl)
        .then((res) => {
          setResult(res.medicine);
          setStatus('done');
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 503) {
            setStatus('unavailable');
            return;
          }
          setErrorMessage(err instanceof ApiError ? err.message : 'Could not read that photo. Try again.');
          setStatus('error');
        });
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setPhoto(undefined);
    setResult(undefined);
    setErrorMessage(undefined);
    setStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="page fade-up">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">Medicine scanner</h1>
        <Link to="/" className="small" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
          Home
        </Link>
      </div>
      <p className="small" style={{ marginTop: -8, marginBottom: 4 }}>
        Photograph a medicine pack, blister strip, or bottle label. VITALIS reads what's actually legible — it will
        never guess a name or invent an expiry date.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {photo === undefined ? (
        <button
          className="glass card"
          onClick={() => inputRef.current?.click()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '48px 20px',
            border: '1px dashed rgba(23,105,232,0.35)',
            cursor: 'pointer',
          }}
        >
          <CameraIcon size={34} />
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
            Take or choose a photo
          </span>
          <span className="small">JPG or PNG · stays on this device until you scan</span>
        </button>
      ) : (
        <div className="glass card" style={{ padding: 12 }}>
          <img src={photo} alt="Medicine pack" style={{ width: '100%', borderRadius: 14, display: 'block' }} />
        </div>
      )}

      {status === 'reading' ? (
        <div className="glass card" style={{ textAlign: 'center' }}>
          <span className="glass-loading" style={{ color: 'var(--primary)' }}>
            <span className="dot-beat" />
            <span className="dot-beat" />
            <span className="dot-beat" />
          </span>
          <p className="small" style={{ marginTop: 10 }}>Reading the label…</p>
        </div>
      ) : null}

      {status === 'unavailable' ? (
        <div className="glass card" style={{ borderLeft: '3px solid var(--warn)' }}>
          <div className="label" style={{ color: 'var(--warn)' }}>Not available</div>
          <p className="small" style={{ marginTop: 6 }}>
            Medicine photo identification is not configured on this server right now. Please check the medicine's
            printed label directly.
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="glass card" style={{ borderLeft: '3px solid var(--danger-deep)' }}>
          <div className="label" style={{ color: 'var(--danger-deep)' }}>Couldn't read that photo</div>
          <p className="small" style={{ marginTop: 6 }}>{errorMessage}</p>
        </div>
      ) : null}

      {status === 'done' && result !== undefined ? <ResultCard result={result} /> : null}

      {photo !== undefined ? (
        <button className="btn btn-secondary" onClick={reset}>
          {status === 'done' || status === 'error' || status === 'unavailable' ? 'Scan another' : 'Cancel'}
        </button>
      ) : null}

      <p className="foot" style={{ textAlign: 'center', marginTop: 4 }}>
        Not a substitute for reading the physical label. Always verify expiry and dosage yourself before taking any
        medicine.
      </p>
    </div>
  );
}

function ResultCard({ result }: { readonly result: MedicineIdentification }) {
  const lowConfidence = result.confidence < 0.5;
  return (
    <div className="glass card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="label">Reading</div>
        <span
          className="pill"
          style={{
            fontSize: 10,
            padding: '3px 9px',
            background: lowConfidence ? 'rgba(245,166,35,0.15)' : 'rgba(34,197,94,0.15)',
            color: lowConfidence ? 'var(--warn)' : 'var(--ok)',
            border: 'none',
          }}
        >
          {lowConfidence ? 'Low confidence' : `${Math.round(result.confidence * 100)}% confident`}
        </span>
      </div>

      <Field label="Product name" value={result.productName} />
      <Field label="Strength / dosage" value={result.strength} />
      <Field label="Expiry date" value={result.expiryDateText} />
      <Field label="Manufacturer" value={result.manufacturer} />

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
        <div className="label">Notes</div>
        <p className="small" style={{ marginTop: 6 }}>{result.notes}</p>
      </div>
    </div>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string | undefined }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid var(--divider)' }}>
      <span className="small">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 700,
          fontSize: 13,
          color: value === undefined ? 'var(--danger-deep)' : 'var(--ink)',
          textAlign: 'right',
          maxWidth: '60%',
        }}
      >
        {value ?? 'Not clearly visible — please verify from the package'}
      </span>
    </div>
  );
}
