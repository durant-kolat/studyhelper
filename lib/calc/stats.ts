// Statistiques descriptives sur une série de valeurs saisie par
// l'utilisateur. Séparateurs acceptés : espaces, retours à la ligne ou
// « ; ». La virgule est un séparateur DÉCIMAL (3,5) comme en français.

import { CalcError } from "./engine";
import { clean } from "./format";

export function parseNumberList(text: string): number[] {
  const tokens = text.split(/[\s;]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) throw new CalcError("Saisis au moins une valeur.");
  if (tokens.length > 2000) throw new CalcError("Trop de valeurs (maximum 2000).");

  return tokens.map((token) => {
    const normalized = token.replace(",", ".");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalized)) {
      throw new CalcError(
        `Valeur invalide : « ${token} ». Sépare les valeurs par des espaces ou des « ; » (décimales : 3,5 ou 3.5).`
      );
    }
    return Number(normalized);
  });
}

export type StatsSummary = {
  n: number;
  sum: number;
  sumSquares: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  range: number;
  variancePopulation: number;
  stdPopulation: number;
  varianceSample: number | null;
  stdSample: number | null;
};

export function summarize(values: number[]): StatsSummary {
  const n = values.length;
  if (n === 0) throw new CalcError("Saisis au moins une valeur.");

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const ss = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const varPop = ss / n;
  const varSample = n > 1 ? ss / (n - 1) : null;

  return {
    n,
    sum: clean(sum),
    sumSquares: clean(values.reduce((a, b) => a + b * b, 0)),
    mean: clean(mean),
    median: clean(median),
    min: sorted[0],
    max: sorted[n - 1],
    range: clean(sorted[n - 1] - sorted[0]),
    variancePopulation: clean(varPop),
    stdPopulation: clean(Math.sqrt(varPop)),
    varianceSample: varSample === null ? null : clean(varSample),
    stdSample: varSample === null ? null : clean(Math.sqrt(varSample)),
  };
}
