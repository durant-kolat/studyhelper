// Affichage des résultats de la calculatrice : nettoyage des erreurs
// d'arrondi binaires, notation scientifique, fractions, nombres complexes.
// Aucune dépendance — utilisable partout et testable isolément.

export type Cx = { re: number; im: number };

/**
 * Supprime le bruit d'arrondi binaire (0.1 + 0.2 → 0.3) en gardant 15
 * chiffres significatifs, et normalise -0 en 0.
 */
export function clean(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x === 0 ? 0 : x;
  const r = Number(x.toPrecision(15));
  return Object.is(r, -0) ? 0 : r;
}

/** Annule les parties réelle/imaginaire négligeables devant l'autre. */
export function snap(z: Cx): Cx {
  const scale = Math.max(Math.abs(z.re), Math.abs(z.im));
  if (scale === 0) return z;
  const eps = 1e-13 * scale;
  return {
    re: Math.abs(z.re) < eps ? 0 : z.re,
    im: Math.abs(z.im) < eps ? 0 : z.im,
  };
}

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  "+": "⁺",
};

export function superscript(value: number | string): string {
  return String(value)
    .split("")
    .map((c) => SUPERSCRIPTS[c] ?? c)
    .join("");
}

export type NotationMode = "auto" | "sci";

/** Écrit un réel pour l'affichage (12 chiffres significatifs). */
export function formatReal(x: number, mode: NotationMode = "auto"): string {
  if (!Number.isFinite(x)) return "Erreur";
  if (x === 0) return "0";

  const abs = Math.abs(x);
  const useSci = mode === "sci" || abs >= 1e12 || abs < 1e-6;

  if (!useSci) {
    return String(Number(x.toPrecision(12)));
  }

  const [mantissaRaw, exponentRaw] = x.toExponential(9).split("e");
  const mantissa = mantissaRaw.includes(".")
    ? mantissaRaw.replace(/0+$/, "").replace(/\.$/, "")
    : mantissaRaw;
  const exponent = Number(exponentRaw);
  return `${mantissa}×10${superscript(exponent)}`;
}

/** Chaîne ré-injectable dans une expression (jamais de notation « pretty »). */
export function rawReal(x: number): string {
  return String(clean(x));
}

export function formatComplex(z: Cx, mode: NotationMode = "auto"): string {
  if (z.im === 0) return formatReal(z.re, mode);

  const imAbs = Math.abs(z.im);
  const imText = imAbs === 1 ? "i" : `${formatReal(imAbs, mode)}i`;
  if (z.re === 0) return z.im < 0 ? `−${imText}` : imText;
  return `${formatReal(z.re, mode)} ${z.im < 0 ? "−" : "+"} ${imText}`;
}

export function rawComplex(z: Cx): string {
  if (z.im === 0) return rawReal(z.re);
  const im = rawReal(Math.abs(z.im));
  const sign = z.im < 0 ? "-" : "+";
  if (z.re === 0) return z.im < 0 ? `-${im}*i` : `${im}*i`;
  return `(${rawReal(z.re)}${sign}${im}*i)`;
}

/**
 * Approximation rationnelle par fractions continues. Renvoie null si le
 * nombre n'est pas (proche d')une fraction à petit dénominateur.
 */
export function toFraction(
  x: number,
  maxDenominator = 10000,
  tolerance = 1e-10
): { num: number; den: number } | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return { num: x, den: 1 };

  const sign = x < 0 ? -1 : 1;
  const target = Math.abs(x);

  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = target;

  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDenominator) return null;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(target - h1 / k1) <= tolerance * Math.max(1, target)) {
      return { num: sign * h1, den: k1 };
    }
    const frac = b - a;
    if (frac < 1e-15) break;
    b = 1 / frac;
  }
  return null;
}

export function formatFraction(x: number): string | null {
  const f = toFraction(x);
  if (!f) return null;
  if (f.den === 1) return String(f.num);
  return `${f.num < 0 ? "−" : ""}${Math.abs(f.num)}/${f.den}`;
}
