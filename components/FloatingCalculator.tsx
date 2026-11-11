"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, Trash2, X } from "lucide-react";
import type { Cx } from "@/lib/calc/engine";
import { CalcSettings, DEFAULT_SETTINGS } from "@/lib/calc/ui-helpers";
import { announceToolOpen, onOtherToolOpen } from "@/lib/floating-tools";
import CalcTab, { Committed, Injection } from "./calculator/CalcTab";
import EquationsTab from "./calculator/EquationsTab";
import AnalysisTab from "./calculator/AnalysisTab";
import StatsTab from "./calculator/StatsTab";

// Calculatrice scientifique flottante (Terminale → Université).
// Le calcul est fait par lib/calc/engine.ts : un parseur écrit pour ça,
// sans eval() ni new Function(). Voir ce fichier pour le détail des
// fonctions (trigonométrie DEG/RAD/GRAD, complexes, statistiques…).

type Tab = "calc" | "history" | "equations" | "analysis" | "stats";

const TABS: { id: Tab; label: string }[] = [
  { id: "calc", label: "Calcul" },
  { id: "history", label: "Hist." },
  { id: "equations", label: "Équ." },
  { id: "analysis", label: "Analyse" },
  { id: "stats", label: "Stats" },
];

type HistoryEntry = { id: number; expr: string; display: string; raw: string };

const STORAGE_KEY = "sh_calc_v1";
const MAX_HISTORY = 50;

function loadStored(): { settings: CalcSettings; history: HistoryEntry[] } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = parsed?.settings ?? {};
    const settings: CalcSettings = {
      angle: s.angle === "RAD" || s.angle === "GRAD" ? s.angle : "DEG",
      complex: s.complex === true,
      notation: s.notation === "sci" ? "sci" : "auto",
      fraction: s.fraction === true,
    };
    const history: HistoryEntry[] = Array.isArray(parsed?.history)
      ? parsed.history
          .filter(
            (h: unknown): h is HistoryEntry =>
              typeof h === "object" &&
              h !== null &&
              typeof (h as HistoryEntry).expr === "string" &&
              typeof (h as HistoryEntry).display === "string" &&
              typeof (h as HistoryEntry).raw === "string"
          )
          .slice(0, MAX_HISTORY)
      : [];
    return { settings, history };
  } catch {
    return null;
  }
}

function ToggleButton({
  pressed,
  onClick,
  label,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded-card border px-2.5 py-1 text-xs font-medium ${
        pressed
          ? "border-ink bg-ink text-paper"
          : "border-mist bg-white text-slate hover:border-ink hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export default function FloatingCalculator() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("calc");
  const [settings, setSettings] = useState<CalcSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [ans, setAns] = useState<Cx | undefined>(undefined);
  const [injection, setInjection] = useState<Injection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nonce = useRef(0);

  // Réglages et historique : mémorisés sur l'appareil (localStorage, protégé
  // par try/catch — navigation privée ou stockage plein ne cassent rien).
  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      setSettings(stored.settings);
      setHistory(stored.history);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, history }));
    } catch {
      /* stockage indisponible : on continue sans mémoriser */
    }
  }, [settings, history, loaded]);

  // Ne se chevauche jamais avec l'horloge ; Échap referme.
  useEffect(() => onOtherToolOpen("calculator", () => setOpen(false)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen) announceToolOpen("calculator");
      return !wasOpen;
    });
  }

  function commit(entry: Committed) {
    setAns(entry.value);
    setHistory((prev) =>
      [
        { id: Date.now() + Math.random(), expr: entry.expr, display: entry.display, raw: entry.raw },
        ...prev,
      ].slice(0, MAX_HISTORY)
    );
  }

  function reuse(text: string, replace: boolean) {
    nonce.current += 1;
    setInjection({ nonce: nonce.current, text, replace });
    setTab("calc");
  }

  const set = <K extends keyof CalcSettings>(key: K, value: CalcSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Fermer la calculatrice" : "Ouvrir la calculatrice"}
        aria-expanded={open}
        aria-controls="floating-calculator-panel"
        onClick={toggle}
        className="fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-clay text-paper shadow-lg hover:bg-clay/90"
        style={{
          right: "1rem",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {open ? <X size={20} /> : <Calculator size={20} />}
      </button>

      {open && (
        <div
          id="floating-calculator-panel"
          role="dialog"
          aria-label="Calculatrice scientifique"
          className="floating-panel fixed z-50 flex flex-col rounded-card border border-mist bg-white shadow-xl"
          style={{
            right: "1rem",
            bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
            width: "min(22rem, calc(100vw - 2rem))",
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-mist px-3 py-2">
            <p className="font-display text-sm text-ink">Calculatrice scientifique</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer la calculatrice"
              className="rounded-full p-1.5 text-slate hover:bg-mist2"
            >
              <X size={16} />
            </button>
          </div>

          <div className="overflow-y-auto overscroll-contain p-3">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <div
                role="group"
                aria-label="Mode angulaire"
                className="flex overflow-hidden rounded-card border border-mist"
              >
                {(["DEG", "RAD", "GRAD"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={settings.angle === mode}
                    onClick={() => set("angle", mode)}
                    className={`px-2.5 py-1 text-xs font-medium ${
                      settings.angle === mode
                        ? "bg-ink text-paper"
                        : "bg-white text-slate hover:text-ink"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <ToggleButton
                pressed={settings.complex}
                onClick={() => set("complex", !settings.complex)}
                label="ℂ"
                title="Nombres complexes"
              />
              <ToggleButton
                pressed={settings.notation === "sci"}
                onClick={() => set("notation", settings.notation === "sci" ? "auto" : "sci")}
                label="Sci"
                title="Notation scientifique"
              />
              <ToggleButton
                pressed={settings.fraction}
                onClick={() => set("fraction", !settings.fraction)}
                label="a/b"
                title="Résultats en fractions"
              />
            </div>

            <div role="tablist" aria-label="Sections de la calculatrice" className="mb-3 flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`calc-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`calc-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 rounded-card px-1 py-1.5 text-xs font-medium ${
                    tab === t.id
                      ? "bg-ink text-paper"
                      : "bg-mist2 text-slate hover:text-ink"
                  }`}
                >
                  {t.label}
                  {t.id === "history" && history.length > 0 ? ` (${history.length})` : ""}
                </button>
              ))}
            </div>

            {/* Tous les onglets restent montés : on ne perd pas la saisie en changeant d'onglet. */}
            <div
              role="tabpanel"
              id="calc-panel-calc"
              aria-labelledby="calc-tab-calc"
              hidden={tab !== "calc"}
            >
              <CalcTab settings={settings} ans={ans} onCommit={commit} injection={injection} />
            </div>

            <div
              role="tabpanel"
              id="calc-panel-history"
              aria-labelledby="calc-tab-history"
              hidden={tab !== "history"}
            >
              {history.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate">
                  Aucun calcul pour l'instant.
                </p>
              ) : (
                <>
                  <p className="mb-1 text-[11px] text-slate/70">
                    Touche l'expression pour la modifier, le résultat pour l'insérer.
                  </p>
                  <ul className="max-h-72 overflow-y-auto">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-center gap-2 border-b border-mist py-2">
                        <button
                          type="button"
                          onClick={() => reuse(h.expr, true)}
                          title="Réutiliser l'expression"
                          className="min-w-0 flex-1 truncate text-left text-xs text-slate hover:text-ink"
                        >
                          {h.expr}
                        </button>
                        <button
                          type="button"
                          onClick={() => reuse(h.raw, false)}
                          title="Insérer le résultat dans le calcul"
                          className="max-w-[45%] shrink-0 truncate rounded bg-mist2 px-2 py-1 text-sm font-medium text-ink hover:bg-mist"
                        >
                          = {h.display}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setHistory([])}
                    className="mt-3 flex items-center gap-1.5 text-xs text-slate hover:text-clay"
                  >
                    <Trash2 size={13} /> Effacer l'historique
                  </button>
                </>
              )}
            </div>

            <div
              role="tabpanel"
              id="calc-panel-equations"
              aria-labelledby="calc-tab-equations"
              hidden={tab !== "equations"}
            >
              <EquationsTab angle={settings.angle} />
            </div>

            <div
              role="tabpanel"
              id="calc-panel-analysis"
              aria-labelledby="calc-tab-analysis"
              hidden={tab !== "analysis"}
            >
              <AnalysisTab angle={settings.angle} />
            </div>

            <div
              role="tabpanel"
              id="calc-panel-stats"
              aria-labelledby="calc-tab-stats"
              hidden={tab !== "stats"}
            >
              <StatsTab />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
