// Analyse numérique : dérivée, intégrale, tableau de valeurs.
// Toutes les fonctions reçoivent une fonction JS déjà compilée depuis le
// parseur sécurisé (compile() dans engine.ts) — jamais du texte à exécuter.

import { CalcError } from "./engine";

export type Fn = (x: number) => number;

function round10(v: number) {
  return Number(v.toPrecision(10));
}

/** Évalue f et transforme tout échec (domaine, division par zéro…) en message clair. */
function safe(f: Fn, x: number, where: string): number {
  let v: number;
  try {
    v = f(x);
  } catch (err) {
    throw new CalcError(
      `f n'est pas définie ${where} : ${err instanceof Error ? err.message : "erreur"}`
    );
  }
  if (!Number.isFinite(v)) {
    throw new CalcError(`f n'est pas définie ${where}.`);
  }
  return v;
}

/**
 * Dérivée numérique en x0 : formule centrée à 5 points, erreur en O(h⁴),
 * précise à ~10 chiffres pour les fonctions usuelles.
 */
export function derivativeAt(f: Fn, x0: number): number {
  const h = 1e-3 * Math.max(1, Math.abs(x0));
  const where = "au voisinage de x₀";
  const f2p = safe(f, x0 + 2 * h, where);
  const f1p = safe(f, x0 + h, where);
  const f1m = safe(f, x0 - h, where);
  const f2m = safe(f, x0 - 2 * h, where);

  const d = (-f2p + 8 * f1p - 8 * f1m + f2m) / (12 * h);
  const scale = Math.max(Math.abs(f2p), Math.abs(f1p), Math.abs(f1m), Math.abs(f2m));
  // Sous le bruit d'arrondi de la formule : c'est un vrai zéro.
  if (Math.abs(d) < 1e-10 * scale) return 0;
  return round10(d);
}

/**
 * Intégrale numérique sur [a, b] : Simpson adaptatif après un découpage
 * initial en 16 tranches (évite de rater une oscillation, ex. sin sur
 * [0 ; 2π]). Le nombre d'évaluations est borné pour ne jamais bloquer
 * le navigateur.
 */
export function integrate(f: Fn, a: number, b: number): number {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  let evaluations = 0;
  const MAX_EVALUATIONS = 150_000;
  const g = (x: number) => {
    evaluations++;
    return safe(f, x, `sur l'intervalle [${lo} ; ${hi}] (en x = ${round10(x)})`);
  };

  const simpson = (fa: number, fm: number, fb: number, x0: number, x1: number) =>
    ((x1 - x0) / 6) * (fa + 4 * fm + fb);

  // Passe grossière : estimation de l'échelle pour fixer la tolérance.
  const slices = 16;
  const width = (hi - lo) / slices;
  const nodes: { x0: number; x1: number; fa: number; fm: number; fb: number; whole: number }[] = [];
  let magnitude = 0;
  let fPrev = g(lo);
  for (let i = 0; i < slices; i++) {
    const x0 = lo + i * width;
    const x1 = i === slices - 1 ? hi : x0 + width;
    const fm = g((x0 + x1) / 2);
    const fb = g(x1);
    const whole = simpson(fPrev, fm, fb, x0, x1);
    nodes.push({ x0, x1, fa: fPrev, fm, fb, whole });
    magnitude += Math.abs(whole);
    fPrev = fb;
  }

  const eps = 1e-11 * Math.max(magnitude, 1e-12);

  const refine = (
    x0: number,
    x1: number,
    fa: number,
    fm: number,
    fb: number,
    whole: number,
    tol: number,
    depth: number
  ): number => {
    const m = (x0 + x1) / 2;
    const flm = g((x0 + m) / 2);
    const frm = g((m + x1) / 2);
    const left = simpson(fa, flm, fm, x0, m);
    const right = simpson(fm, frm, fb, m, x1);
    const delta = left + right - whole;
    if (depth <= 0 || evaluations > MAX_EVALUATIONS || Math.abs(delta) <= 15 * tol) {
      return left + right + delta / 15;
    }
    return (
      refine(x0, m, fa, flm, fm, left, tol / 2, depth - 1) +
      refine(m, x1, fm, frm, fb, right, tol / 2, depth - 1)
    );
  };

  let total = 0;
  for (const n of nodes) {
    total += refine(n.x0, n.x1, n.fa, n.fm, n.fb, n.whole, eps / slices, 18);
  }

  if (Math.abs(total) < 1e-10 * magnitude) total = 0;
  return sign * round10(total);
}

export type TableRow = { x: number; y: number | null };

/** Tableau de valeurs de f. Une valeur non définie donne y = null (pas d'échec global). */
export function valueTable(
  f: Fn,
  start: number,
  end: number,
  step: number,
  maxRows = 60
): TableRow[] {
  if (step === 0 || !Number.isFinite(step)) {
    throw new CalcError("Le pas doit être non nul.");
  }
  if ((end - start) * step < 0) {
    throw new CalcError("Le pas doit aller de la borne de départ vers la borne de fin.");
  }
  const count = Math.floor((end - start) / step + 1e-9) + 1;
  if (count > maxRows) {
    throw new CalcError(`Trop de lignes (${count}) : maximum ${maxRows}. Augmente le pas.`);
  }

  const rows: TableRow[] = [];
  for (let i = 0; i < count; i++) {
    const x = Number((start + i * step).toPrecision(12));
    let y: number | null = null;
    try {
      const v = f(x);
      y = Number.isFinite(v) ? v : null;
    } catch {
      y = null;
    }
    rows.push({ x, y });
  }
  return rows;
}
