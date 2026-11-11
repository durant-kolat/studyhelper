// Convertit le LaTeX renvoyé par l'IA en texte simple lisible :
//   \sqrt{4}            -> √4          sqrt(x+1) -> √(x+1)
//   $3\sqrt{2} + 4\sqrt{2}$ -> 3√2 + 4√2
//   \frac{a}{b}         -> (a)/(b)
// Garantit qu'aucun `\`, `{}` ni `$` n'est affiché à l'utilisateur final.
// Les racines passent par normalizeMathNotation() (lib/math-normalize.ts) :
// notation √ lisible, code (math.sqrt(2), blocs ```) jamais transformé.

import { normalizeMathNotation } from "./math-normalize";

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈",
  infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ",
  delta: "δ", Delta: "Δ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω",
  Omega: "Ω", sum: "Σ", rightarrow: "→", to: "→", Rightarrow: "⇒",
  leftarrow: "←", degree: "°", circ: "°",
};

export function cleanMath(input: unknown): string {
  if (input === null || input === undefined) return "";
  let t = String(input);

  // Un JSON mal échappé transforme \frac, \times, \neq, \right, \beta… en
  // caractères de contrôle (\f, \t, \n, \r, \b) : on les remet en backslash.
  t = t
    .replace(/\f/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\t(?=imes|ext|heta|au\b|an\b)/g, "\\t")
    .replace(/\r(?=ight|ho\b)/g, "\\r")
    .replace(/\n(?=eq\b|abla|u\b)/g, "\\n");

  // Délimiteurs LaTeX : $...$, $$...$$, \( \), \[ \]
  t = t.replace(/\\[()[\]]/g, "").replace(/\$/g, "");

  // Racines (\sqrt{…}, \sqrt[3]{…}, sqrt(…)) → √ : AVANT le reste, pour traiter
  // correctement les accolades imbriquées (ex. \sqrt{\frac{a}{b}}).
  t = normalizeMathNotation(t);

  // Commandes à arguments, de l'intérieur vers l'extérieur (imbrications).
  for (let i = 0; i < 6; i++) {
    const before = t;
    t = t
      .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\(?:text|mathrm|mathbf|textbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\^\s*\{([^{}]*)\}/g, (_m, e: string) => (e.length > 1 ? `^(${e})` : `^${e}`))
      .replace(/_\s*\{([^{}]*)\}/g, (_m, e: string) => (e.length > 1 ? `_(${e})` : `_${e}`));
    if (t === before) break;
  }

  t = t
    .replace(/\\left|\\right/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\\[,;:! ]|\\quad|\\qquad/g, " ")
    .replace(/\\([a-zA-Z]+)/g, (_m, name: string) => SYMBOLS[name] ?? name)
    // Reste éventuel : backslash isolés et accolades orphelines.
    .replace(/\\/g, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]{2,}/g, " ");

  return normalizeMathNotation(t).trim();
}

/** Nettoie question + options + méthode d'une question de QCM. */
export function cleanQuestion<
  T extends { question: string; options: string[]; method?: string }
>(q: T): T {
  return {
    ...q,
    question: cleanMath(q.question),
    options: q.options.map(cleanMath),
    ...(q.method !== undefined ? { method: cleanMath(q.method) } : {}),
  };
}
