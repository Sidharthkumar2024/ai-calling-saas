'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_LOCALE,
  isPortalLocale,
  translate,
  type PortalLocale,
  type TranslationKey,
} from '@/lib/i18n';

/**
 * Portal locale. Stored per browser rather than per workspace: two people in
 * the same workspace can want different interface languages, and the workspace
 * setting already means something else (which languages the AI may speak).
 */
const STORAGE_KEY = 'vaani.portal.locale';

type LocaleContextValue = {
  locale: PortalLocale;
  setLocale: (locale: PortalLocale) => void;
  t: (key: TranslationKey) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => translate(DEFAULT_LOCALE, key),
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<PortalLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    // Read after mount so the server and first client render agree, and
    // deferred so the first paint is not a cascading re-render.
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (isPortalLocale(stored)) {
          setLocaleState(stored);
          document.documentElement.lang = stored;
          return;
        }
        // Fall back to the browser's own preference when it is one we speak.
        const preferred = navigator.languages?.find((tag) =>
          isPortalLocale(tag.split('-')[0]),
        );
        if (preferred) {
          const code = preferred.split('-')[0] as PortalLocale;
          setLocaleState(code);
          document.documentElement.lang = code;
        }
      } catch {
        /* storage unavailable: English is fine */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setLocale = useCallback((next: PortalLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: TranslationKey) => translate(locale, key),
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** Shorthand for components that only need the translator. */
export function useT() {
  return useContext(LocaleContext).t;
}
