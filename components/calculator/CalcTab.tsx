"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import type { Cx } from "@/lib/calc/engine";
import {
  CalcSettings,
  ShownResult,
  autoCloseParentheses,
  compute,
  continueFromAnswer,
  toggleSign,
} from "@/lib/calc/ui-helpers";

export type Committed = {
  expr: string;
  display: string;
  raw: string;
  value: Cx;
};

/** Demande venue de l'historique : insérer du texte dans la saisie. */
export type Injection = { nonce: number; text: string; replace: boolean };

type Props = {
  settings: CalcSettings;
  ans: Cx | undefined;
  onCommit: (entry: Committed) => void;
  injection: Injection | null;
};

type FnKey = { label: string; insert: string; aria?: string };

const FUNCTION_GROUPS: Record<"trig" | "log" | "misc", { title: string; keys: FnKey[] }> = {
  trig: {
    title: "Trigonométrie",
    keys: [
      { label: "sin", insert: "sin(" },
      { label: "cos", insert: "cos(" },
      { label: "tan", insert: "tan(" },
      { label: "sin⁻¹", insert: "asin(", aria: "arc sinus" },
      { label: "cos⁻¹", insert: "acos(", aria: "arc cosinus" },
      { label: "tan⁻¹", insert: "atan(", aria: "arc tangente" },
      { label: "sinh", insert: "sinh(" },
      { label: "cosh", insert: "cosh(" },
      { label: "tanh", insert: "tanh(" },
      { label: "|x|", insert: "abs(", aria: "valeur absolue" },
    ],
  },
  log: {
    title: "Logs & puissances",
    keys: [
      { label: "log", insert: "log(", aria: "logarithme décimal" },
      { label: "ln", insert: "ln(", aria: "logarithme népérien" },
      { label: "eˣ", insert: "e^(", aria: "exponentielle" },
      { label: "10ˣ", insert: "10^(", aria: "dix puissance" },
      { label: "1/x", insert: "1/(", aria: "inverse" },
      { label: "x²", insert: "²", aria: "au carré" },
      { label: "x³", insert: "³", aria: "au cube" },
      { label: "xʸ", insert: "^", aria: "puissance" },
      { label: "√", insert: "√(", aria: "racine carrée" },
      { label: "ⁿ√", insert: "root(", aria: "racine n-ième : root(n ; x)" },
    ],
  },
  misc: {
    title: "Divers",
    keys: [
      { label: "n!", insert: "!", aria: "factorielle" },
      { label: "%", insert: "%", aria: "pourcentage" },
      { label: "π", insert: "π", aria: "pi" },
      { label: "e", insert: "e", aria: "constante e" },
      { label: "i", insert: "i", aria: "unité imaginaire (mode ℂ)" },
      { label: "mod", insert: "mod(", aria: "modulo : mod(a ; b)" },
      { label: "pgcd", insert: "pgcd(", aria: "plus grand commun diviseur" },
      { label: "ppcm", insert: "ppcm(", aria: "plus petit commun multiple" },
      { label: "nCr", insert: "nCr(", aria: "combinaisons : nCr(n ; r)" },
      { label: "nPr", insert: "nPr(", aria: "arrangements : nPr(n ; r)" },
    ],
  },
};

type PadAction =
  | { type: "insert"; text: string }
  | { type: "clear" }
  | { type: "del" }
  | { type: "equals" }
  | { type: "sign" };

type PadKey = {
  label: string;
  aria?: string;
  action: PadAction;
  tone?: "num" | "op" | "danger" | "equals";
  span?: number;
};

const ins = (text: string): PadAction => ({ type: "insert", text });

const PAD: PadKey[] = [
  { label: "AC", aria: "Tout effacer", action: { type: "clear" }, tone: "danger" },
  { label: "⌫", aria: "Effacer le dernier caractère", action: { type: "del" }, tone: "op" },
  { label: "(", action: ins("("), tone: "op" },
  { label: ")", action: ins(")"), tone: "op" },
  { label: "÷", aria: "divisé par", action: ins("÷"), tone: "op" },

  { label: "7", action: ins("7") },
  { label: "8", action: ins("8") },
  { label: "9", action: ins("9") },
  { label: "×", aria: "multiplié par", action: ins("×"), tone: "op" },
  { label: "±", aria: "Changer le signe", action: { type: "sign" }, tone: "op" },

  { label: "4", action: ins("4") },
  { label: "5", action: ins("5") },
  { label: "6", action: ins("6") },
  { label: "−", aria: "moins", action: ins("−"), tone: "op" },
  { label: "Ans", aria: "Dernier résultat", action: ins("ans"), tone: "op" },

  { label: "1", action: ins("1") },
  { label: "2", action: ins("2") },
  { label: "3", action: ins("3") },
  { label: "+", aria: "plus", action: ins("+"), tone: "op" },
  { label: ";", aria: "Séparateur d'arguments", action: ins(";"), tone: "op" },

  { label: "0", action: ins("0") },
  { label: ".", aria: "virgule décimale", action: ins(".") },
  { label: "×10ⁿ", aria: "fois dix puissance", action: ins("×10^"), tone: "op" },
  { label: "=", aria: "Calculer", action: { type: "equals" }, tone: "equals", span: 2 },
];

const TONE_CLASSES: Record<NonNullable<PadKey["tone"]>, string> = {
  num: "border-mist bg-white text-ink hover:border-ink",
  op: "border-mist bg-mist2 text-ink hover:border-ink",
  danger: "border-mist bg-white text-clay hover:border-clay",
  equals: "border-clay bg-clay text-paper hover:bg-clay/90",
};

export default function CalcTab({ settings, ans, onCommit, injection }: Props) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<ShownResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [group, setGroup] = useState<keyof typeof FUNCTION_GROUPS>("trig");
  const [systemKeyboard, setSystemKeyboard] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  // Replace le curseur après chaque modification déclenchée par un bouton.
  useEffect(() => {
    if (caretRef.current === null) return;
    const el = inputRef.current;
    const pos = caretRef.current;
    caretRef.current = null;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(pos, pos);
    }
  });

  function apply(nextExpr: string, caret: number) {
    setExpr(nextExpr);
    setError(null);
    caretRef.current = caret;
  }

  function insert(text: string) {
    if (justEvaluated) {
      // Après « = » : un opérateur continue depuis ans, tout le reste repart à zéro.
      const start = continueFromAnswer(text);
      setJustEvaluated(false);
      setResult(null);
      apply(start, start.length);
      return;
    }
    const el = inputRef.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    apply(expr.slice(0, start) + text + expr.slice(end), start + text.length);
  }

  function backspace() {
    setJustEvaluated(false);
    const el = inputRef.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    if (start !== end) {
      apply(expr.slice(0, start) + expr.slice(end), start);
      return;
    }
    // Efface « sin( » ou « ans » d'un coup, pas lettre par lettre.
    const before = expr.slice(0, start);
    const token = /[A-Za-z]+\($|ans$/.exec(before);
    const cut = token ? token[0].length : 1;
    if (start === 0) return;
    apply(before.slice(0, before.length - cut) + expr.slice(start), start - cut);
  }

  function clearAll() {
    setExpr("");
    setResult(null);
    setError(null);
    setJustEvaluated(false);
    caretRef.current = 0;
  }

  function equals() {
    if (!expr.trim()) return;
    const closed = autoCloseParentheses(expr);
    const out = compute(closed, settings, ans);
    if (!out.ok) {
      setError(out.error);
      setResult(null);
      return;
    }
    setError(null);
    setResult(out.result);
    setExpr(closed);
    setJustEvaluated(true);
    onCommit({
      expr: closed,
      display: out.result.decimal
        ? `${out.result.display} (${out.result.decimal})`
        : out.result.display,
      raw: out.result.raw,
      value: out.result.value,
    });
  }

  function press(action: PadAction) {
    switch (action.type) {
      case "insert":
        insert(action.text);
        break;
      case "clear":
        clearAll();
        break;
      case "del":
        backspace();
        break;
      case "equals":
        equals();
        break;
      case "sign": {
        const next = toggleSign(expr);
        setJustEvaluated(false);
        apply(next, next.length);
        break;
      }
    }
  }

  // Texte envoyé par l'historique (expression ou résultat à réutiliser).
  const lastNonce = useRef(0);
  useEffect(() => {
    if (!injection || injection.nonce === lastNonce.current) return;
    lastNonce.current = injection.nonce;
    setResult(null);
    setJustEvaluated(false);
    if (injection.replace) {
      apply(injection.text, injection.text.length);
    } else {
      const el = inputRef.current;
      const start = el?.selectionStart ?? expr.length;
      const end = el?.selectionEnd ?? expr.length;
      apply(expr.slice(0, start) + injection.text + expr.slice(end), start + injection.text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injection]);

  // Un changement de réglage (DEG → RAD, fraction…) recalcule le résultat affiché.
  useEffect(() => {
    if (!justEvaluated || !expr.trim()) return;
    const out = compute(expr, settings, ans);
    if (out.ok) {
      setResult(out.result);
      setError(null);
    } else {
      setResult(null);
      setError(out.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Aperçu en direct, discret : jamais d'erreur affichée tant qu'on tape.
  const preview = useMemo(() => {
    if (justEvaluated || !expr.trim()) return null;
    const out = compute(expr, settings, ans);
    return out.ok ? out.result : null;
  }, [expr, settings, ans, justEvaluated]);

  const shown = result ?? preview;

  return (
    <div>
      <div className="rounded-card bg-ink px-3 pb-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-gold" aria-label={`Mode angulaire ${settings.angle}`}>
            {settings.angle}
            {settings.complex ? " · ℂ" : ""}
          </span>
          <button
            type="button"
            onClick={() => setSystemKeyboard((v) => !v)}
            aria-pressed={systemKeyboard}
            aria-label="Utiliser le clavier de l'appareil"
            title="Clavier de l'appareil"
            className={`rounded p-1 ${systemKeyboard ? "bg-white/20 text-paper" : "text-paper/50 hover:text-paper"}`}
          >
            <Keyboard size={14} />
          </button>
        </div>

        <label htmlFor="calc-expression" className="sr-only">
          Expression à calculer
        </label>
        <input
          id="calc-expression"
          ref={inputRef}
          value={expr}
          onChange={(e) => {
            setExpr(e.target.value);
            setError(null);
            setJustEvaluated(false);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              equals();
            }
          }}
          placeholder="Ex. sin(30) + 2^3"
          inputMode={systemKeyboard ? "text" : "none"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-transparent text-right font-display text-lg text-paper outline-none placeholder:text-paper/30"
        />

        <div className="min-h-[2.5rem] text-right" aria-live="polite">
          {shown ? (
            <>
              <p
                className={`break-all font-display ${
                  result ? "text-3xl text-paper" : "text-lg text-paper/50"
                }`}
              >
                {result ? "" : "= "}
                {shown.display}
              </p>
              {shown.decimal && (
                <p className="text-xs text-paper/60">≈ {shown.decimal}</p>
              )}
            </>
          ) : (
            <p className="font-display text-3xl text-paper/30">0</p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-card bg-clay/10 px-3 py-2 text-xs text-clay">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-1" role="tablist" aria-label="Groupes de fonctions">
        {(Object.keys(FUNCTION_GROUPS) as (keyof typeof FUNCTION_GROUPS)[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={group === key}
            onClick={() => setGroup(key)}
            className={`flex-1 rounded-card px-2 py-1.5 text-[11px] font-medium ${
              group === key ? "bg-ink text-paper" : "bg-mist2 text-slate hover:text-ink"
            }`}
          >
            {FUNCTION_GROUPS[key].title}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {FUNCTION_GROUPS[group].keys.map((k) => (
          <button
            key={k.label}
            type="button"
            aria-label={k.aria ?? k.label}
            onClick={() => insert(k.insert)}
            className="h-10 rounded-card border border-mist bg-white text-[13px] text-ink hover:border-ink active:bg-mist2"
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {PAD.map((k) => (
          <button
            key={k.label}
            type="button"
            aria-label={k.aria ?? k.label}
            onClick={() => press(k.action)}
            className={`h-11 rounded-card border text-sm font-medium active:opacity-80 ${
              TONE_CLASSES[k.tone ?? "num"]
            } ${k.span === 2 ? "col-span-2" : ""}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-snug text-slate/70">
        Décimales avec un point (1.5). Arguments séparés par « ; » : pgcd(12 ; 18).
        Les parenthèses ouvertes sont fermées automatiquement.
      </p>
    </div>
  );
}
