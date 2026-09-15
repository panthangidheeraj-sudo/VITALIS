import { useEffect, useState } from 'react';

export type LanguageCode = 'en' | 'hi' | 'te';

const STORAGE_KEY = 'vitalis.language.v1';

function detectDefaultLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.split('-')[0];
  if (lang === 'hi') return 'hi';
  if (lang === 'te') return 'te';
  return 'en';
}

function isLanguageCode(value: string | null): value is LanguageCode {
  return value === 'en' || value === 'hi' || value === 'te';
}

/**
 * Guarded the same way every other store in this folder guards its reads.
 * This one runs as a `useState` INITIALIZER, i.e. during the first render of
 * any component that shows translated text, so an unguarded throw here (a
 * browser with site data blocked, a private window) would not degrade the
 * language — it would take the whole render down with it.
 */
function getStoredLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    // Fall through to the browser's own language.
  }
  return detectDefaultLanguage();
}

export function useLanguage() {
  const [language, setLanguageState] = useState<LanguageCode>(getStoredLanguage);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      // Validated rather than cast: this value can come from another tab,
      // and an unchecked cast would let an unsupported code through into
      // the translation lookup.
      if (e.key === STORAGE_KEY && isLanguageCode(e.newValue)) {
        setLanguageState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = (lang: LanguageCode) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // The choice still applies to this session; it just will not survive
      // a reload. Better than refusing to switch language at all.
    }
    setLanguageState(lang);
    // Trigger custom event so components in the same window update instantly
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: lang }));
  };

  return { language, setLanguage };
}
