"use client";

// Petits éléments d'interface partagés par les onglets de la calculatrice.

import { formatFraction, formatReal } from "@/lib/calc/format";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  id,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-0.5 block text-[11px] text-slate">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`w-full min-w-0 rounded-card border border-mist px-2 py-2 text-sm text-ink outline-none focus:border-ink ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="mt-3 w-full rounded-card bg-clay py-2.5 text-sm font-medium text-paper hover:bg-clay/90"
    >
      {children}
    </button>
  );
}

export function Results({
  lines,
  note,
  error,
}: {
  lines: string[];
  note?: string | null;
  error?: string | null;
}) {
  if (!error && lines.length === 0) return null;
  return (
    <div className="mt-3" role="status" aria-live="polite">
      {error ? (
        <p role="alert" className="rounded-card bg-clay/10 px-3 py-2 text-xs text-clay">
          {error}
        </p>
      ) : (
        <div className="rounded-card bg-ink px-3 py-3">
          {lines.map((line, i) => (
            <p key={i} className="break-words font-display text-base text-paper">
              {line}
            </p>
          ))}
          {note && <p className="mt-2 text-xs text-paper/60">{note}</p>}
        </div>
      )}
    </div>
  );
}

/** « 3/2 (= 1.5) » quand le nombre est une fraction simple, sinon le décimal. */
export function niceNumber(x: number): string {
  const fraction = formatFraction(x);
  if (fraction && fraction.includes("/")) return `${fraction} (= ${formatReal(x)})`;
  return formatReal(x);
}
