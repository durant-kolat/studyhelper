// Développement et factorisation de polynômes en x.
// L'expression est lue par le même parseur sécurisé que la calculatrice
// (aucun eval) puis convertie en coefficients.
//
// Factorisation : théorème des racines rationnelles + division exacte.
// C'est ce qui se fait « à la main » au lycée / en L1 : on trouve les
// racines rationnelles p/q, on en extrait les facteurs (qx − p), et on
// indique honnêtement ce qui reste non factorisé.

import { Node, parse, CalcError } from "./engine";
import { clean, formatFraction, formatReal, superscript, toFraction } from "./format";

/** Coefficients par degré croissant : [c0, c1, c2] = c0 + c1·x + c2·x². */
export type Poly = number[];

const MAX_DEGREE = 60;

function trim(p: Poly): Poly {
  const out = [...p];
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

function padd(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? 0) + (b[i] ?? 0));
  return trim(out);
}

function pscale(a: Poly, k: number): Poly {
  return trim(a.map((c) => c * k));
}

function pmul(a: Poly, b: Poly): Poly {
  if (a.length + b.length - 2 > MAX_DEGREE) throw new CalcError("Degré trop élevé (max 60).");
  const out: Poly = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return trim(out);
}

function ppow(a: Poly, n: number): Poly {
  let result: Poly = [1];
  for (let i = 0; i < n; i++) result = pmul(result, a);
  return result;
}

function isConstant(p: Poly) {
  return p.length === 1;
}

function nodeToPoly(n: Node): Poly {
  switch (n.k) {
    case "num":
      return [n.v];
    case "sym":
      if (n.name === "x") return [0, 1];
      if (n.name === "pi") return [Math.PI];
      if (n.name === "e") return [Math.E];
      throw new CalcError(`Seule la variable x est autorisée (trouvé : « ${n.name} »).`);
    case "neg":
      return pscale(nodeToPoly(n.a), -1);
    case "bin": {
      const a = nodeToPoly(n.a);
      const b = nodeToPoly(n.b);
      switch (n.op) {
        case "+":
          return padd(a, b);
        case "-":
          return padd(a, pscale(b, -1));
        case "*":
          return pmul(a, b);
        case "/":
          if (!isConstant(b) || b[0] === 0) {
            throw new CalcError("Division : seul un diviseur constant non nul est accepté.");
          }
          return pscale(a, 1 / b[0]);
        case "^": {
          if (!isConstant(b) || !Number.isInteger(b[0]) || b[0] < 0 || b[0] > 30) {
            throw new CalcError("Exposant : entier entre 0 et 30 attendu.");
          }
          return ppow(a, b[0]);
        }
      }
      break;
    }
    case "post":
      if (n.op === "²") return ppow(nodeToPoly(n.a), 2);
      if (n.op === "³") return ppow(nodeToPoly(n.a), 3);
      throw new CalcError("Opérateur non autorisé dans un polynôme.");
    case "pct":
    case "fn":
      throw new CalcError("Seuls +, −, ×, ^ et les parenthèses sont autorisés ici.");
  }
  throw new CalcError("Expression invalide.");
}

export function parsePolynomial(expression: string): Poly {
  return nodeToPoly(parse(expression)).map(clean);
}

function coefficientText(c: number): string {
  const frac = Number.isInteger(c) ? null : formatFraction(c);
  if (frac && frac.length <= 9) return `(${frac})`;
  return formatReal(c);
}

function xPower(d: number): string {
  if (d === 0) return "";
  return d === 1 ? "x" : `x${superscript(d)}`;
}

export function formatPolynomial(p: Poly): string {
  const poly = trim(p.map(clean));
  const terms: { neg: boolean; body: string }[] = [];

  for (let d = poly.length - 1; d >= 0; d--) {
    const c = poly[d];
    if (c === 0) continue;
    const abs = Math.abs(c);
    let body: string;
    if (d === 0) body = coefficientText(abs);
    else if (abs === 1) body = xPower(d);
    else body = `${coefficientText(abs)}${xPower(d)}`;
    terms.push({ neg: c < 0, body });
  }

  if (terms.length === 0) return "0";
  return terms
    .map((t, i) => (i === 0 ? (t.neg ? `−${t.body}` : t.body) : ` ${t.neg ? "−" : "+"} ${t.body}`))
    .join("");
}

export function expandExpression(expression: string): { polynomial: Poly; text: string; degree: number } {
  const polynomial = parsePolynomial(expression);
  return { polynomial, text: formatPolynomial(polynomial), degree: polynomial.length - 1 };
}

// ---------------------------------------------------------------------------
// Factorisation
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function divisors(n: number): number[] {
  n = Math.abs(n);
  const out: number[] = [];
  for (let d = 1; d * d <= n; d++) {
    if (n % d === 0) {
      out.push(d);
      if (d * d !== n) out.push(n / d);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Vrai si Σ coeffs[i]·p^i·q^(d−i) = 0 (calcul exact en entiers). */
function isRationalRoot(coeffs: number[], p: number, q: number): boolean {
  const d = coeffs.length - 1;
  const bp = BigInt(p);
  const bq = BigInt(q);
  // Horner homogène : évite toute division.
  let acc = BigInt(coeffs[d]);
  for (let i = d - 1; i >= 0; i--) {
    acc = acc * bp + BigInt(coeffs[i]) * bq ** BigInt(d - i);
  }
  return acc === BigInt(0);
}

/** Q / (q·x − p), division exacte en entiers. Renvoie null si elle n'est pas exacte. */
function divideByLinear(coeffs: number[], p: number, q: number): number[] | null {
  const d = coeffs.length - 1;
  const out: number[] = new Array(d).fill(0);
  let carry = 0;
  for (let i = d; i >= 1; i--) {
    const value = coeffs[i] + carry * p;
    if (value % q !== 0) return null;
    out[i - 1] = value / q;
    carry = out[i - 1];
  }
  if (coeffs[0] + carry * p !== 0) return null;
  return out;
}

export type FactorResult =
  | { ok: true; text: string; factored: boolean; note?: string }
  | { ok: false; reason: string };

function fractionText(num: number, den: number): string {
  return den === 1 ? String(num) : `(${num}/${den})`;
}

export function factorPolynomial(input: Poly): FactorResult {
  const poly = trim(input.map(clean));
  if (poly.length === 1) {
    return { ok: false, reason: "Le polynôme est une constante : rien à factoriser." };
  }

  // 1) coefficients rationnels → entiers
  const fractions = poly.map((c) => toFraction(c, 1000, 1e-9));
  if (fractions.some((f) => f === null)) {
    return { ok: false, reason: "Coefficients non rationnels : factorisation exacte impossible." };
  }
  let lcm = 1;
  for (const f of fractions as { num: number; den: number }[]) {
    lcm = (lcm / gcd(lcm, f.den)) * f.den;
    if (lcm > 1e6) return { ok: false, reason: "Coefficients trop complexes pour la factorisation." };
  }
  let ints = (fractions as { num: number; den: number }[]).map((f) => (f.num * lcm) / f.den);

  // 2) contenu (pgcd) et signe : P = (±contenu / lcm) · Q, Q primitif à coefficient dominant > 0
  let content = ints.reduce((a, b) => gcd(a, b), 0);
  if (content === 0) return { ok: false, reason: "Polynôme nul." };
  const sign = ints[ints.length - 1] < 0 ? -1 : 1;
  ints = ints.map((c) => (c * sign) / content);
  let constNum = sign * content;
  let constDen = lcm;
  const g = gcd(constNum, constDen);
  constNum /= g;
  constDen /= g;

  if (ints.some((c) => Math.abs(c) > 1e9)) {
    return { ok: false, reason: "Coefficients trop grands pour la factorisation." };
  }

  // 3) facteur x^m
  let xMultiplicity = 0;
  while (ints.length > 1 && ints[0] === 0) {
    ints = ints.slice(1);
    xMultiplicity++;
  }

  // 4) racines rationnelles p/q
  const roots: { p: number; q: number; multiplicity: number }[] = [];
  let searching = ints.length > 1;
  while (searching && ints.length > 1) {
    searching = false;
    const lead = ints[ints.length - 1];
    const last = ints[0];
    if (Math.abs(last) > 1e7 || Math.abs(lead) > 1e7) break;
    const ps = divisors(last);
    const qs = divisors(lead);
    outer: for (const q of qs) {
      for (const p0 of ps) {
        if (gcd(p0, q) !== 1) continue;
        for (const p of [p0, -p0]) {
          if (!isRationalRoot(ints, p, q)) continue;
          const quotient = divideByLinear(ints, p, q);
          if (!quotient) continue;
          const existing = roots.find((r) => r.p === p && r.q === q);
          if (existing) existing.multiplicity++;
          else roots.push({ p, q, multiplicity: 1 });
          ints = quotient;
          searching = ints.length > 1;
          break outer;
        }
      }
    }
  }

  // 5) affichage
  const parts: string[] = [];
  if (!(constNum === 1 && constDen === 1)) {
    if (constNum === -1 && constDen === 1) parts.push("−");
    else parts.push(fractionText(constNum, constDen).replace(/^-/, "−"));
  }
  if (xMultiplicity > 0) parts.push(xMultiplicity === 1 ? "x" : `x${superscript(xMultiplicity)}`);

  // Ordre d'écriture usuel : racines de plus petite valeur absolue d'abord,
  // à égalité la racine positive d'abord → (x − 1)(x + 1), (x + 2)(x + 3).
  roots.sort((a, b) => {
    const ra = a.p / a.q;
    const rb = b.p / b.q;
    return Math.abs(ra) - Math.abs(rb) || rb - ra;
  });
  for (const r of roots) {
    const factor = `(${formatPolynomial([-r.p, r.q])})`;
    parts.push(r.multiplicity > 1 ? `${factor}${superscript(r.multiplicity)}` : factor);
  }

  let note: string | undefined;
  const remainder = ints.length > 1 ? ints : null;
  if (remainder) {
    parts.push(`(${formatPolynomial(remainder)})`);
    if (remainder.length === 3) {
      const [c, b, a] = remainder;
      const delta = b * b - 4 * a * c;
      note =
        delta < 0
          ? `Le facteur restant a Δ = ${delta} < 0 : irréductible dans ℝ.`
          : `Le facteur restant a Δ = ${delta} > 0 sans être un carré parfait : ses racines sont irrationnelles (pas de facteurs à coefficients rationnels).`;
    } else {
      note = "Le facteur restant n'a pas de racine rationnelle ; il n'est pas décomposé davantage ici.";
    }
  }

  const factored = roots.length > 0 || xMultiplicity > 0 || !(constNum === 1 && constDen === 1);
  const text = parts.join("").replace(/^−(?=\()/, "−");
  return {
    ok: true,
    text: text || formatPolynomial(poly),
    factored,
    note:
      note ??
      (factored ? undefined : "Aucune racine rationnelle : le polynôme n'est pas factorisable simplement."),
  };
}

export function factorExpression(expression: string): FactorResult {
  return factorPolynomial(parsePolynomial(expression));
}
