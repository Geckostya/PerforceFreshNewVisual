import { saveLanguage } from "./api";
import { useLocale } from "./i18n";
import { Languages } from "lucide-react";

export function LanguagePicker({ onSaveError }: { onSaveError?: () => void }) {
  const { language, languages, setLanguage } = useLocale();

  function handleChange(next: string) {
    setLanguage(next);
    void saveLanguage(next).catch(() => onSaveError?.());
  }

  return (
    <label className="language-picker">
      <Languages className="language-icon" aria-hidden="true" />
      <span className="language-word">Language</span>
      <select value={language} onChange={(event) => handleChange(event.target.value)} aria-label="Language">
        {languages.map((locale) => <option value={locale.code} key={locale.code}>{locale.name}</option>)}
      </select>
    </label>
  );
}
