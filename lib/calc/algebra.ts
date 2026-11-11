// Résolution d'équations : 1er degré, 2nd degré (discriminant, racines
// réelles ou complexes) et systèmes linéaires 2×2 / 3×3 (élimination de
// Gauss avec pivot partiel, détection des systèmes impossibles/indéterminés).

import { Cx, clean } from "./format";
import { CalcError } from "./engine";

export type LinearResult =
  | { kind: "unique"; x: number }
  | { kind: "none" }
  | { kind: "all" };

/** a·x + b = 0 */
export function solveLinear(a: number, b: number): LinearResult {
  if (a === 0) return b === 0 ? { kind: "all" } : { kind: "none" };
  return { kind: "unique", x: clean(-b / a) };
}

export type QuadraticResult =
  | { kind: "linear"; linear: LinearResult }
  | {
      kind: "quadratic";
      discriminant: number;
      nature: "deux racines réelles distinctes" | "une racine double" | "deux racines complexes conjuguées";
      roots: Cx[];
    };

/** a·x² + b·x + c = 0 */
export function solveQuadratic(a: number, b: number, c: number): QuadraticResult {
  if (a === 0) return { kind: "linear", linear: solveLinear(b, c) };

  const discriminant = clean(b * b - 4 * a * c);

  if (discriminant > 0) {
    const sqrtD = Math.sqrt(discriminant);
    // Formule stable : évite la perte de précision par soustraction de
    // deux nombres proches quand b² ≫ 4ac.
    const q = -(b + (b >= 0 ? 1 : -1) * sqrtD) / 2;
    const r1 = q / a;
    const r2 = c / q;
    const [lo, hi] = r1 < r2 ? [r1, r2] : [r2, r1];
    return {
      kind: "quadratic",
      discriminant,
      nature: "deux racines réelles distinctes",
      roots: [
        { re: clean(lo), im: 0 },
        { re: clean(hi), im: 0 },
      ],
    };
  }

  if (discriminant === 0) {
    return {
      kind: "quadratic",
      discriminant: 0,
      nature: "une racine double",
      roots: [{ re: clean(-b / (2 * a)), im: 0 }],
    };
  }

  const re = clean(-b / (2 * a));
  const im = clean(Math.sqrt(-discriminant) / (2 * Math.abs(a)));
  return {
    kind: "quadratic",
    discriminant,
    nature: "deux racines complexes conjuguées",
    roots: [
      { re, im: -im },
      { re, im },
    ],
  };
}

export type SystemResult =
  | { kind: "unique"; solution: number[]; determinant: number }
  | { kind: "none" }
  | { kind: "infinite" };

/** Résout A·x = b (A carrée 2×2 ou 3×3). */
export function solveSystem(matrix: number[][], rhs: number[]): SystemResult {
  const n = matrix.length;
  if (n < 2 || n > 3 || matrix.some((row) => row.length !== n) || rhs.length !== n) {
    throw new CalcError("Système : matrice 2×2 ou 3×3 attendue.");
  }

  const det = determinant(matrix);

  // Matrice augmentée [A | b] réduite par Gauss-Jordan.
  const m = matrix.map((row, i) => [...row, rhs[i]]);
  const scale = Math.max(1, ...m.flat().map((v) => Math.abs(v)));
  const eps = 1e-10 * scale;

  let rank = 0;
  const pivotCols: number[] = [];
  for (let col = 0; col < n && rank < n; col++) {
    let best = rank;
    for (let r = rank + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[best][col])) best = r;
    }
    if (Math.abs(m[best][col]) <= eps) continue;
    [m[rank], m[best]] = [m[best], m[rank]];
    const pivot = m[rank][col];
    for (let c = col; c <= n; c++) m[rank][c] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === rank) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[rank][c];
    }
    pivotCols.push(col);
    rank++;
  }

  // Ligne « 0 = k » avec k ≠ 0 → aucun solution.
  for (let r = rank; r < n; r++) {
    if (Math.abs(m[r][n]) > eps) return { kind: "none" };
  }
  if (rank < n) return { kind: "infinite" };

  return {
    kind: "unique",
    solution: pivotCols.map((_, i) => clean(m[i][n])),
    determinant: clean(det),
  };
}

export function determinant(m: number[][]): number {
  if (m.length === 2) {
    return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  }
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
