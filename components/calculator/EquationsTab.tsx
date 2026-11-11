"use client";

import { FormEvent, useState } from "react";
import { AngleMode, CalcError, evaluateReal } from "@/lib/calc/engine";
import { solveLinear, solveQuadratic, solveSystem } from "@/lib/calc/algebra";
import { expandExpression, factorExpression } from "@/lib/calc/polynomial";
import { formatComplex, formatReal } from "@/lib/calc/format";
import { Field, PrimaryButton, Results, niceNumber } from "./ui";

type Mode = "lin" | "quad" | "sys2" | "sys3" | "expand" | "factor";

const MODES: { id: Mode; label: string }[] = [
  { id: "lin", label: "Équation du 1er degré  ax + b = 0" },
  { id: "quad", label: "Équation du 2nd degré  ax² + bx + c = 0" },
  { id: "sys2", label: "Système 2 × 2" },
  { id: "sys3", label: "Système 3 × 3" },
  { id: "expand", label: "Développer un polynôme en x" },
  { id: "factor", label: "Factoriser un polynôme en x" },
];

const SUB = ["₁", "₂", "₃"];
const VARS = ["x", "y", "z"];

export default function EquationsTab({ angle }: { angle: AngleMode }) {
  const [mode, setMode] = useState<Mode>("quad");
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const get = (key: string) => values[key] ?? "";

  // Une case vide vaut 0 ; les fractions et racines sont acceptées (1/2, sqrt(2)).
  function num(key: string, label: string): number {
    const text = get(key).trim();
    if (text === "") return 0;
    try {
      return evaluateReal(text, { angle });
    } catch (err) {
      throw new CalcError(`${label} : ${err instanceof CalcError ? err.message : "valeur invalide"}`);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNote(null);
    setLines([]);
    try {
      const out: string[] = [];
      let outNote: string | null = null;

      if (mode === "lin") {
        const a = num("a", "a");
        const b = num("b", "b");
        const r = solveLinear(a, b);
        if (r.kind === "unique") out.push(`x = ${niceNumber(r.x)}`);
        else if (r.kind === "none") out.push("Aucune solution (0 = constante non nulle).");
        else out.push("Tout réel est solution (0 = 0).");
      }

      if (mode === "quad") {
        const a = num("a", "a");
        const b = num("b", "b");
        const c = num("c", "c");
        const r = solveQuadratic(a, b, c);
        if (r.kind === "linear") {
          outNote = "a = 0 : l'équation est du 1er degré.";
          if (r.linear.kind === "unique") out.push(`x = ${niceNumber(r.linear.x)}`);
          else if (r.linear.kind === "none") out.push("Aucune solution.");
          else out.push("Tout réel est solution.");
        } else {
          out.push(`Δ = b² − 4ac = ${formatReal(r.discriminant)}`);
          out.push(r.nature.charAt(0).toUpperCase() + r.nature.slice(1));
          if (r.roots.length === 1) {
            out.push(`x = ${niceNumber(r.roots[0].re)}`);
          } else if (r.nature === "deux racines complexes conjuguées") {
            r.roots.forEach((z, i) => out.push(`x${SUB[i]} = ${formatComplex(z)}`));
          } else {
            r.roots.forEach((z, i) => out.push(`x${SUB[i]} = ${niceNumber(z.re)}`));
            const allInt = [a, b, c].every(Number.isInteger);
            const root = Math.sqrt(r.discriminant);
            if (allInt && !Number.isInteger(root)) {
              outNote = `Forme exacte : x = (${-b} ± √${r.discriminant}) / ${2 * a}`;
            }
          }
        }
      }

      if (mode === "sys2" || mode === "sys3") {
        const n = mode === "sys2" ? 2 : 3;
        const matrix: number[][] = [];
        const rhs: number[] = [];
        for (let r = 0; r < n; r++) {
          const row: number[] = [];
          for (let c = 0; c < n; c++) row.push(num(`m${r}${c}`, `${VARS[c]} (ligne ${r + 1})`));
          matrix.push(row);
          rhs.push(num(`k${r}`, `second membre (ligne ${r + 1})`));
        }
        const res = solveSystem(matrix, rhs);
        if (res.kind === "unique") {
          res.solution.forEach((v, i) => out.push(`${VARS[i]} = ${niceNumber(v)}`));
          outNote = `Déterminant = ${formatReal(res.determinant)}`;
        } else if (res.kind === "none") {
          out.push("Système impossible : aucune solution.");
        } else {
          out.push("Système indéterminé : une infinité de solutions.");
        }
      }

      if (mode === "expand") {
        const r = expandExpression(get("poly"));
        out.push(r.text);
        outNote = `Polynôme de degré ${r.degree}`;
      }

      if (mode === "factor") {
        const r = factorExpression(get("poly"));
        if (!r.ok) throw new CalcError(r.reason);
        out.push(r.text);
        outNote = r.note ?? null;
      }

      setLines(out);
      setNote(outNote);
    } catch (err) {
      setError(err instanceof CalcError ? err.message : "Résolution impossible.");
    }
  }

  const n = mode === "sys2" ? 2 : 3;

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="eq-mode" className="mb-1 block text-xs font-medium text-slate">
        Que veux-tu faire ?
      </label>
      <select
        id="eq-mode"
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as Mode);
          setLines([]);
          setNote(null);
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
        {mode === "lin" && (
          <div className="grid grid-cols-2 gap-2">
            <Field id="eq-a" label="a" value={get("a")} onChange={set("a")} placeholder="0" />
            <Field id="eq-b" label="b" value={get("b")} onChange={set("b")} placeholder="0" />
          </div>
        )}

        {mode === "quad" && (
          <div className="grid grid-cols-3 gap-2">
            <Field id="eq-a" label="a" value={get("a")} onChange={set("a")} placeholder="0" />
            <Field id="eq-b" label="b" value={get("b")} onChange={set("b")} placeholder="0" />
            <Field id="eq-c" label="c" value={get("c")} onChange={set("c")} placeholder="0" />
          </div>
        )}

        {(mode === "sys2" || mode === "sys3") && (
          <div className="space-y-2">
            {Array.from({ length: n }, (_, r) => (
              <div
                key={r}
                className={`grid items-end gap-1.5 ${n === 2 ? "grid-cols-3" : "grid-cols-4"}`}
              >
                {Array.from({ length: n }, (_, c) => (
                  <Field
                    key={c}
                    id={`eq-m${r}${c}`}
                    label={`${VARS[c]} (éq. ${r + 1})`}
                    value={get(`m${r}${c}`)}
                    onChange={set(`m${r}${c}`)}
                    placeholder="0"
                  />
                ))}
                <Field
                  id={`eq-k${r}`}
                  label="= second membre"
                  value={get(`k${r}`)}
                  onChange={set(`k${r}`)}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        )}

        {(mode === "expand" || mode === "factor") && (
          <Field
            id="eq-poly"
            label={mode === "expand" ? "Expression en x" : "Polynôme en x"}
            value={get("poly")}
            onChange={set("poly")}
            placeholder={mode === "expand" ? "(x+1)^2 * (2x-3)" : "x^2 - 5x + 6"}
            mono
          />
        )}
      </div>

      <PrimaryButton>
        {mode === "expand" ? "Développer" : mode === "factor" ? "Factoriser" : "Résoudre"}
      </PrimaryButton>

      <Results lines={lines} note={note} error={error} />
    </form>
  );
}
