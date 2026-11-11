"use client";

import { FormEvent, useState } from "react";
import { CalcError } from "@/lib/calc/engine";
import { formatReal } from "@/lib/calc/format";
import { StatsSummary, parseNumberList, summarize } from "@/lib/calc/stats";
import { PrimaryButton } from "./ui";

export default function StatsTab() {
  const [text, setText] = useState("");
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStats(null);
    try {
      setStats(summarize(parseNumberList(text)));
    } catch (err) {
      setError(err instanceof CalcError ? err.message : "Calcul impossible.");
    }
  }

  const f = (x: number | null) => (x === null ? "— (il faut ≥ 2 valeurs)" : formatReal(x));

  const rowsData: [string, string][] = stats
    ? [
        ["Effectif n", String(stats.n)],
        ["Somme Σx", f(stats.sum)],
        ["Somme des carrés Σx²", f(stats.sumSquares)],
        ["Moyenne x̄", f(stats.mean)],
        ["Médiane", f(stats.median)],
        ["Minimum", f(stats.min)],
        ["Maximum", f(stats.max)],
        ["Étendue", f(stats.range)],
        ["Variance σ² (population)", f(stats.variancePopulation)],
        ["Écart-type σ (population)", f(stats.stdPopulation)],
        ["Variance s² (échantillon)", f(stats.varianceSample)],
        ["Écart-type s (échantillon)", f(stats.stdSample)],
      ]
    : [];

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="stats-input" className="mb-1 block text-xs font-medium text-slate">
        Série de valeurs
      </label>
      <textarea
        id="stats-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="12 15,5 9 14 ; 18"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-card border border-mist px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
      />
      <p className="mt-1 text-[11px] text-slate/70">
        Sépare les valeurs par des espaces, des retours à la ligne ou « ; ». La virgule est décimale (15,5).
      </p>

      <PrimaryButton>Calculer les statistiques</PrimaryButton>

      {error && (
        <p role="alert" className="mt-3 rounded-card bg-clay/10 px-3 py-2 text-xs text-clay">
          {error}
        </p>
      )}

      {stats && (
        <dl className="mt-3 divide-y divide-mist rounded-card border border-mist" role="status">
          {rowsData.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
              <dt className="text-slate">{label}</dt>
              <dd className="text-right font-medium tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </form>
  );
}
