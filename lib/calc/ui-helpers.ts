// Petites fonctions pures utilisées par l'interface de la calculatrice
// (testables sans navigateur).

import {
  AngleMode,
  CalcError,
  Cx,
  evaluate,
} from "./engine";
import {
  NotationMode,
  formatComplex,
  formatFraction,
  formatReal,
  rawComplex,
} from "./format";

export type CalcSettings = {
  angle: AngleMode;
  complex: boolean;
  notation: NotationMode;
  /** Affiche les résultats réels sous forme de fraction quand c'est possible. */
  fraction: boolean;
};

export const DEFAULT_SETTINGS: CalcSettings = {
  angle: "DEG",
  complex: false,
  notation: "auto",
  fraction: false,
};

/** Ferme les parenthèses laissées ouvertes en fin de saisie (comme une calculatrice). */
export function autoCloseParentheses(expression: string): string {
  let depth = 0;
  for (const ch of expression) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
  }
  return expression + ")".repeat(depth);
}

const NUMBER_ONLY = /^[-−]?(\d+\.?\d*|\.\d+)$/;

/** Touche ± : change le signe du nombre saisi ou de toute l'expression. */
export function toggleSign(expression: string): string {
  const e = expression.trim();
  if (e === "") return "−";
  if (NUMBER_ONLY.test(e)) return e.startsWith("-") || e.startsWith("−") ? e.slice(1) : `−${e}`;
  if (/^[-−]\(.*\)$/.test(e)) return e.slice(2, -1);
  if (e === "−") return "";
  return `−(${e})`;
}

export type ShownResult = {
  /** Texte affiché (fraction, notation scientifique…). */
  display: string;
  /** Texte ré-injectable dans une expression. */
  raw: string;
  /** Équivalent décimal quand l'affichage principal est une fraction. */
  decimal?: string;
  value: Cx;
};

export function presentResult(value: Cx, settings: CalcSettings): ShownResult {
  const raw = rawComplex(value);
  if (value.im !== 0) {
    return { display: formatComplex(value, settings.notation), raw, value };
  }
  if (settings.fraction) {
    const frac = formatFraction(value.re);
    if (frac && frac.includes("/")) {
      return { display: frac, raw, decimal: formatReal(value.re, settings.notation), value };
    }
  }
  return { display: formatReal(value.re, settings.notation), raw, value };
}

export type Computation =
  | { ok: true; result: ShownResult }
  | { ok: false; error: string };

export function compute(
  expression: string,
  settings: CalcSettings,
  ans?: Cx
): Computation {
  try {
    const value = evaluate(autoCloseParentheses(expression), {
      angle: settings.angle,
      complex: settings.complex,
      ans,
    });
    return { ok: true, result: presentResult(value, settings) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof CalcError ? err.message : "Calcul impossible.",
    };
  }
}

const BINARY_START = /^[+\-−×÷*/^%!²³]/;

/** Après « = », une touche d'opérateur continue depuis ans ; toute autre repart à zéro. */
export function continueFromAnswer(text: string): string {
  return BINARY_START.test(text) && !/^[-−]$/.test(text) ? `ans${text}` : text;
}
