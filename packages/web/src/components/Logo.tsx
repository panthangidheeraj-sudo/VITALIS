/**
 * Single canonical VITALIS logo mark. Every brand-mark location in the app
 * (header, loading state, anywhere a placeholder used to be) renders through
 * this component instead of duplicating the asset path or wordmark styling.
 */

const LOGO_SRC = '/assets/vitalis-logo.svg';

export function Logo({ size = 32, rounded = true, id }: { readonly size?: number; readonly rounded?: boolean; readonly id?: string }) {
  return (
    <img
      id={id}
      src={LOGO_SRC}
      alt="VITALIS"
      width={size}
      height={size}
      style={{ display: 'block', borderRadius: rounded ? size * 0.25 : 0, flex: 'none' }}
    />
  );
}

export function Wordmark({ size = 32, textSize = 17, logoId }: { readonly size?: number; readonly textSize?: number; readonly logoId?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.28 }}>
      <Logo size={size} id={logoId} />
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 800,
          fontSize: textSize,
          letterSpacing: 0.2,
          color: 'var(--ink)',
        }}
      >
        VITALIS
      </span>
    </div>
  );
}
