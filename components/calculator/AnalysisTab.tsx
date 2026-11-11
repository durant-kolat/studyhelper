"use client";

import { FormEvent, useState } from "react";
import { AngleMode, CalcError, compile, evaluateReal } from "@/lib/calc/engine";
import { derivativeAt, integrate, TableRow, valueTable } from "@/lib/calc/numeric";
import { formatReal } from "@/lib/calc/format";
import { Field, PrimaryButton, Results, niceNumber } from "./ui";

type Mode = "value" | "derivative" | "integral" | "table";

const MODES: { id: Mode; label: string }[] = [
  { id: "value", label: "Valeur  f(x₀)" },
  { id: "derivative", label: "Dérivée en un point  f′(x₀)" },
  { id: "integral", label: "Intégrale  ∫ f(x) dx sur [a ; b]" },
  { id: "table", label: "Tableau de valeurs" },
];

export default function AnalysisTab({ angle }: { angle: AngleMode }) {
  const [mode, setMode] = useState<Mode>("value");
  const [fx, setFx] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<string[]>([]);
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (v: string) => setValues((p) => ({ ...p, [key]: v }));
  const get = (key: string) => values[key] ?? "";

  function num(key: string, label: string): number {
    const text = get(key).trim();
    if (text === "") throw new CalcError(`Renseigne « ${label} ».`);
    try {
      return evaluateReal(text, { angle });
    } catch (err) {
      throw new CalcError(`${label} : ${err instanceof CalcError ? err.message : "valeur invalide"}`);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLines([]);
    setRows(null);
    try {
      if (fx.trim() === "") throw new CalcError("Écris d'abord f(x), par exemple x^2 + 3x.");
      const compiled = compile(fx, { angle, complex: false });
      const f = (x: number) => compiled({ x });

      if (mode === "value") {
        const x0 = num("x0", "x₀");
        setLines([`f(${formatReal(x0)}) = ${niceNumber(f(x0))}`]);
      }
      if (mode === "derivative") {
        const x0 = num("x0", "x₀");
        setLines([`f′(${formatReal(x0)}) ≈ ${niceNumber(derivativeAt(f, x0))}`]);
      }
      if (mode === "integral") {
        const a = num("a", "a");
        const b = num("b", "b");
        setLines([`∫ de ${formatReal(a)} à ${formatReal(b)} ≈ ${niceNumber(integrate(f, a, b))}`]);
      }
      if (mode === "table") {
        const start = num("start", "début");
        const end = num("end", "fin");
        const step = num("step", "pas");
        setRows(valueTable(f, start, end, step));
      }
    } catch (err) {
      setError(err instanceof CalcError ? err.message : "Calcul impossible.");
    }
  }

  const usesTrig = /(sin|cos|tan)/i.test(fx);
  const needsRadians = usesTrig && angle !== "RAD" && (mode === "derivative" || mode === "integral");

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field
        id="an-fx"
        label="f(x) = (la variable est x)"
        value={fx}
        onChange={setFx}
        placeholder="x^2 + 3x − 1"
        mono
      />

      <label htmlFor="an-mode" className="mb-1 mt-3 block text-xs font-medium text-slate">
        Que veux-tu calculer ?
      </label>
      <select
        id="an-mode"
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as Mode);
          setLines([]);
          setRows(null);
          setError(null);
        }}
        className="w-full rounded-card border border-mist bg-white px-2 py-2 text-sm text-ink"
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      <div className="mt-3">
        {(mode === "value" || mode === "derivative") && (
          <Field id="an-x0" label="x₀" value={get("x0")} onChange={set("x0")} placeholder="2" />
        )}
        {mode === "integral" && (
          <div className="grid grid-cols-2 gap-2">
            <Field id="an-a" label="a (borne inférieure)" value={get("a")} onChange={set("a")} placeholder="0" />
            <Field id="an-b" label="b (borne supérieure)" value={get("b")} onChange={set("b")} placeholder="1" />
          </div>
        )}
        {mode === "table" && (
          <div className="grid grid-cols-3 gap-2">
            <Field id="an-start" label="début" value={get("start")} onChange={set("start")} placeholder="0" />
            <Field id="an-end" label="fin" value={get("end")} onChange={set("end")} placeholder="5" />
            <Field id="an-step" label="pas" value={get("step")} onChange={set("step")} placeholder="1" />
          </div>
        )}
      </div>

      {needsRadians && (
        <p className="mt-2 rounded-card bg-gold/20 px-3 py-2 text-xs text-ink">
          Le mode angulaire est {angle} : sin, cos et tan travaillent donc en{" "}
          {angle === "DEG" ? "degrés" : "grades"}. Pour dériver ou intégrer, passe en RAD.
        </p>
      )}

      <PrimaryButton>Calculer</PrimaryButton>

      <Results lines={lines} error={error} note={lines.length ? "Résultats numériques (10 chiffres significatifs)." : null} />

      {rows && (
        <div className="mt-3 max-h-56 overflow-auto rounded-card border border-mist" role="status">
          <table className="w-full text-sm">
            <caption className="sr-only">Tableau de valeurs de f</caption>
            <thead className="sticky top-0 bg-mist2 text-xs text-slate">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">x</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">f(x)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-mist">
                  <td className="px-3 py-1.5 tabular-nums">{formatReal(r.x)}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {r.y === null ? <span className="text-slate/60">non définie</span> : formatReal(r.y)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
