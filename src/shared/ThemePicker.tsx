import { SunMoon } from "lucide-react";
import { saveTheme } from "./api";
import { useLocale } from "./i18n";
import type { ThemeMode } from "./models";
import { useTheme } from "./theme";

export function ThemePicker({ onSaveError }: { onSaveError?: () => void }) {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();

  function handleChange(next: ThemeMode) {
    setTheme(next);
    void saveTheme(next).catch(() => onSaveError?.());
  }

  return <label className="theme-picker">
    <SunMoon className="theme-icon" aria-hidden="true" />
    <span className="theme-word">{t("theme")}</span>
    <select data-agent-id="theme-picker" value={theme} onChange={(event) => handleChange(event.target.value as ThemeMode)} aria-label={t("theme")}>
      <option value="system">{t("themeSystem")}</option>
      <option value="light">{t("themeLight")}</option>
      <option value="dark">{t("themeDark")}</option>
    </select>
  </label>;
}
