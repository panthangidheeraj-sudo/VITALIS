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

function getStoredLanguage(): LanguageCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'hi' || stored === 'te') return stored;
  return detectDefaultLanguage();
}

export function useLanguage() {
  const [language, setLanguageState] = useState<LanguageCode>(getStoredLanguage);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setLanguageState(e.newValue as LanguageCode);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = (lang: LanguageCode) => {
    localStorage.setItem(STORAGE_KEY, lang);
    setLanguageState(lang);
    // Trigger custom event so components in the same window update instantly
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: lang }));
  };

  return { language, setLanguage };
}
