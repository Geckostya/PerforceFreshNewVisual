import { saveLanguage } from "./api";
import { useLocale } from "./i18n";

export function LanguagePicker({ onSaveError }: { onSaveError?: () => void }) {
  const { language, languages, setLanguage } = useLocale();

  function handleChange(next: string) {
    setLanguage(next);
    void saveLanguage(next).catch(() => onSaveError?.());
  }

  return (
    <label className="language-picker">
      <svg className="language-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21M12 3C9.6 5.5 8.4 8.5 8.4 12s1.2 6.5 3.6 9" />
      </svg>
      <span className="language-word">Language</span>
      <select value={language} onChange={(event) => handleChange(event.target.value)} aria-label="Language">
        {languages.map((locale) => <option value={locale.code} key={locale.code}>{locale.name}</option>)}
      </select>
    </label>
  );
}
