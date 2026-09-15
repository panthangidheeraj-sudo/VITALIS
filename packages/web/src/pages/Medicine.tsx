import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type MedicineIdentification, type MedicineInfoSource } from '../api/client';
import { CameraIcon } from '../components/icons';
import { MedicineCard } from '../components/MedicineCard';
import { readImageFile } from '../data/imageInput';

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
  const [sources, setSources] = useState<readonly MedicineInfoSource[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    // Type/size/read validation lives in data/imageInput.ts, shared with the
    // Assistant's camera button, so an oversized photo is refused here with
    // an actionable message instead of becoming an opaque 413 at the server.
    void readImageFile(file).then((read) => {
      if (!read.ok) {
        setPhoto(undefined);
        setResult(undefined);
        setErrorMessage(read.message);
        setStatus('error');
        return;
      }
      setPhoto(read.dataUrl);
      setResult(undefined);
      setErrorMessage(undefined);
      setStatus('reading');
      api
        .identifyMedicine(read.dataUrl)
        .then((res) => {
          setResult(res.medicine);
          setSources(res.sources ?? []);
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
    });
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
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared immediately so re-picking the SAME file still fires a
          // change event — otherwise retrying after an error does nothing.
          e.target.value = '';
          onFile(file);
        }}
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

      {/* Same card the Assistant renders, so the two paths can never show a
          medicine differently or disagree about where its uses came from. */}
      {status === 'done' && result !== undefined ? <MedicineCard medicine={result} sources={sources} /> : null}

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
