"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { LANGUAGES, isLangCode, hasHandwrittenUi } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * Sélecteur « Langue de l'application ». Changer la langue met à jour TOUTE l'interface
 * immédiatement, puis l'enregistre dans le profil (preferred_language) si l'utilisateur est connecté.
 * `compact` : version discrète pour les pages publiques (connexion, inscription).
 */
export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function onChange(value: string) {
    if (!isLangCode(value)) return;
    const { saved } = await setLang(value);
    setStatus(saved ? "saved" : "error");
    setTimeout(() => setStatus("idle"), 2500);
  }

  const select = (
    <select
      aria-label={t("settings.language.label")}
      value={lang}
      onChange={(e) => onChange(e.target.value)}
      className={compact ? "rounded-card border border-mist bg-white px-2 py-1 text-xs text-ink" : "mt-3 w-full rounded-card border border-mist px-3 py-2 text-sm"}
    >
      <optgroup label="—">
        {LANGUAGES.filter((l) => hasHandwrittenUi(l.code)).map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="+">
        {LANGUAGES.filter((l) => !hasHandwrittenUi(l.code)).map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
            {"beta" in l ? " (beta)" : ""}
          </option>
        ))}
      </optgroup>
    </select>
  );

  if (compact) return <div className="flex items-center gap-1.5 text-slate"><Globe size={14} />{select}</div>;

  return (
    <div className="mt-6 max-w-lg rounded-card border border-mist bg-white p-6">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-clay" />
        <p className="font-display text-sm text-ink">{t("settings.language.label")}</p>
      </div>
      <p className="mt-2 text-sm text-slate">{t("settings.language.help")}</p>
      {select}
      {status === "saved" && <p className="mt-2 text-xs text-forest">{t("settings.language.saved")}</p>}
      {status === "error" && <p className="mt-2 text-xs text-clay">{t("settings.language.saveError")}</p>}
    </div>
  );
}
