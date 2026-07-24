import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import english from "../../locales/en.json";
import type { LocaleBundle } from "./models";

export type TranslationKey = keyof typeof english.translations;

interface LocaleContextValue {
  language: string;
  languages: Pick<LocaleBundle, "code" | "name">[];
  setLanguage: (language: string) => void;
  setLocales: (locales: LocaleBundle[], preferredLanguage?: string) => void;
  t: (key: TranslationKey) => string;
}

const fallback = english as LocaleBundle;
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function translate(locale: LocaleBundle, key: TranslationKey): string {
  return locale.translations[key] ?? fallback.translations[key] ?? key;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState("en");
  const [locales, updateLocales] = useState<LocaleBundle[]>([fallback]);
  const current = locales.find((locale) => locale.code === language) ?? fallback;
  const value = useMemo<LocaleContextValue>(() => ({
    language,
    languages: locales.map(({ code, name }) => ({ code, name })),
    setLanguage,
    setLocales: (next, preferred = language) => {
      const available = next.length > 0 ? next : [fallback];
      updateLocales(available);
      setLanguage(available.some((locale) => locale.code === preferred) ? preferred : "en");
    },
    t: (key) => translate(current, key),
  }), [current, language, locales]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
