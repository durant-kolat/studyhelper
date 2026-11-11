"use client";
import { useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { plannerText, type PlannerKey } from "@/lib/i18n/planner-strings";

/** Traduction du module Planning (langue courante de l'application). */
export function usePT() {
  const { lang } = useI18n();
  const pt = useCallback((key: PlannerKey, vars?: Record<string, string | number>) => plannerText(lang, key, vars), [lang]);
  return { pt, lang };
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function weekdayName(lang: string, dow: number): string {
  // 2026-01-04 est un dimanche : dow 0..6 → jours de la langue choisie, sans clé de traduction à maintenir.
  try { return new Intl.DateTimeFormat(lang, { weekday: "long" }).format(new Date(2026, 0, 4 + dow)); }
  catch { return String(dow); }
}
