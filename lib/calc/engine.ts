// Moteur de la calculatrice scientifique Study Helper.
//
// SÉCURITÉ : aucune utilisation de eval(), new Function() ni équivalent.
// L'expression est découpée en jetons, analysée par un parseur à
// descente récursive qui construit un arbre (AST), puis l'arbre est
// évalué par des fonctions mathématiques écrites ici. Il est
// impossible d'exécuter du JavaScript arbitraire : un symbole inconnu
// est simplement une erreur.

import { Cx, clean, snap } from "./format";

export type { Cx } from "./format";

export type AngleMode = "DEG" | "RAD" | "GRAD";

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

export type EvalOptions = {
  angle: AngleMode;
  /** true : autorise les résultats complexes (sqrt(−4) = 2i, ln(−1) = iπ…). */
  complex: boolean;
  /** Variables supplémentaires (ex. { x: 2 } pour tracer f(x)). */
  vars?: Record<string, number>;
  /** Dernier résultat, accessible par « ans ». */
  ans?: Cx | number;
};

const MAX_LENGTH = 500;
const MAX_DEPTH = 120;

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

const OPS = new Set(["+", "-", "*", "/", "^", "!", "%", "(", ")", ",", "²", "³", "√"]);

function tokenize(source: string): Tok[] {
  if (source.length > MAX_LENGTH) {
    throw new CalcError("Expression trop longue.");
  }

  const s = source
    .replace(/[×·⋅∙]/g, "*")
    .replace(/[÷⁄]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/π/g, " pi ")
    .replace(/;/g, ",");

  const tokens: Tok[] = [];
  const numberRe = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  const idRe = /^[A-Za-zÀ-ÖØ-öø-ÿ_]+/;

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const rest = s.slice(i);

    if (/[0-9.]/.test(ch)) {
      const m = numberRe.exec(rest);
      if (!m) throw new CalcError("Nombre invalide.");
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new CalcError("Nombre trop grand.");
      tokens.push({ t: "num", v });
      i += m[0].length;
      continue;
    }

    const idm = idRe.exec(rest);
    if (idm) {
      tokens.push({ t: "id", v: idm[0].toLowerCase() });
      i += idm[0].length;
      continue;
    }

    if (OPS.has(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
      continue;
    }

    throw new CalcError(`Caractère non reconnu : « ${ch} »`);
  }

  tokens.push({ t: "end" });
  return tokens;
}

// ---------------------------------------------------------------------------
// Arbre syntaxique
// ---------------------------------------------------------------------------

export type Node =
  | { k: "num"; v: number }
  | { k: "sym"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "post"; op: "!" | "%" | "²" | "³"; a: Node }
  // « 200 + 10 % » = 200 + 10 % de 200 (comportement des calculatrices)
  | { k: "pct"; sign: 1 | -1; a: Node; b: Node }
  | { k: "fn"; name: string; args: Node[] };

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.pos];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }
  private enter() {
    if (++this.depth > MAX_DEPTH) throw new CalcError("Expression trop complexe.");
  }
  private leave() {
    this.depth--;
  }

  parse(): Node {
    if (this.peek().t === "end") throw new CalcError("Expression vide.");
    const node = this.parseExpr();
    const t = this.peek();
    if (t.t !== "end") {
      if (t.t === "op" && t.v === ")") {
        throw new CalcError("Parenthèse fermante en trop.");
      }
      if (t.t === "op" && t.v === ",") {
        throw new CalcError(
          "Séparateur inattendu : écris les décimaux avec un point (1.5) ; « ; » ne sépare que les arguments d'une fonction."
        );
      }
      throw new CalcError("Expression invalide.");
    }
    return node;
  }

  private parseExpr(): Node {
    this.enter();
    let node = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "+" || t.v === "-")) {
        this.next();
        const rhs = this.parseTerm();
        if (rhs.k === "post" && rhs.op === "%") {
          node = { k: "pct", sign: t.v === "+" ? 1 : -1, a: node, b: rhs.a };
        } else {
          node = { k: "bin", op: t.v, a: node, b: rhs };
        }
      } else break;
    }
    this.leave();
    return node;
  }

  private startsPrimary(t: Tok) {
    return (
      t.t === "num" ||
      t.t === "id" ||
      (t.t === "op" && (t.v === "(" || t.v === "√"))
    );
  }

  private parseTerm(): Node {
    let node = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "*" || t.v === "/")) {
        this.next();
        node = { k: "bin", op: t.v, a: node, b: this.parseUnary() };
      } else if (this.startsPrimary(t)) {
        // Multiplication implicite : 2π, 3(x+1), 2sin(x)…
        if (t.t === "num" && node.k === "num") {
          throw new CalcError("Deux nombres côte à côte : ajoute un opérateur.");
        }
        node = { k: "bin", op: "*", a: node, b: this.parseUnary() };
      } else break;
    }
    return node;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.t === "op" && (t.v === "-" || t.v === "+")) {
      this.next();
      this.enter();
      const a = this.parseUnary();
      this.leave();
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return this.parsePower();
  }

  // Puissance associative à droite ; l'exposant peut porter un signe : 2^-3.
  private parsePower(): Node {
    const base = this.parsePostfix();
    if (this.isOp("^")) {
      this.next();
      this.enter();
      const exponent = this.parseUnary();
      this.leave();
      return { k: "bin", op: "^", a: base, b: exponent };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "!" || t.v === "%" || t.v === "²" || t.v === "³")) {
        this.next();
        node = { k: "post", op: t.v, a: node };
      } else break;
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.next();

    if (t.t === "num") return { k: "num", v: t.v };

    if (t.t === "op" && t.v === "(") {
      this.enter();
      const inner = this.parseExpr();
      this.leave();
      if (!this.isOp(")")) throw new CalcError("Parenthèse fermante manquante.");
      this.next();
      return inner;
    }

    if (t.t === "op" && t.v === "√") {
      const nt = this.peek();
      if (!(nt.t === "num" || nt.t === "id" || (nt.t === "op" && nt.v === "("))) {
        throw new CalcError("√ doit être suivi d'un nombre ou de parenthèses.");
      }
      return { k: "fn", name: "sqrt", args: [this.parsePrimary()] };
    }

    if (t.t === "id") {
      // « sin(x) » est un appel ; « x(x+2) », « 2π(3) » ou « ans(2) » sont des
      // multiplications implicites : un nom d'une seule lettre ou une
      // constante n'est jamais une fonction.
      if (this.isOp("(") && isFunctionName(t.v)) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        if (!this.isOp(")")) throw new CalcError("Parenthèse fermante manquante.");
        this.next();
        return { k: "fn", name: t.v, args };
      }
      return { k: "sym", name: t.v };
    }

    if (t.t === "end") throw new CalcError("Expression incomplète.");
    throw new CalcError(`Symbole inattendu : « ${t.v} »`);
  }
}


/** Vrai si « nom( » doit être lu comme un appel de fonction. */
function isFunctionName(name: string): boolean {
  if (Object.prototype.hasOwnProperty.call(FUNCTIONS, ALIASES[name] ?? name)) return true;
  if (CONSTANT_NAMES.has(name)) return false;
  return name.length > 1; // inconnu à plusieurs lettres → « Fonction inconnue »
}

export function parse(expression: string): Node {
  return new Parser(tokenize(expression)).parse();
}

// ---------------------------------------------------------------------------
// Arithmétique complexe (un réel est un complexe de partie imaginaire 0)
// ---------------------------------------------------------------------------

const cx = (re: number, im = 0): Cx => ({ re, im });
const isReal = (z: Cx) => z.im === 0;
const cAdd = (a: Cx, b: Cx) => cx(a.re + b.re, a.im + b.im);
const cSub = (a: Cx, b: Cx) => cx(a.re - b.re, a.im - b.im);
const cMul = (a: Cx, b: Cx) =>
  cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);

function cDiv(a: Cx, b: Cx): Cx {
  if (b.re === 0 && b.im === 0) throw new CalcError("Division par zéro.");
  if (a.im === 0 && b.im === 0) return cx(a.re / b.re);
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

const cAbs = (z: Cx) => Math.hypot(z.re, z.im);
// z.im === 0 couvre aussi -0 : sans ça, ln(-1) donnerait -iπ au lieu de +iπ.
const cArgRad = (z: Cx) => Math.atan2(z.im === 0 ? 0 : z.im, z.re);

function cExp(z: Cx): Cx {
  const m = Math.exp(z.re);
  if (z.im === 0) return cx(m);
  return cx(m * Math.cos(z.im), m * Math.sin(z.im));
}

function cLn(z: Cx): Cx {
  if (z.re === 0 && z.im === 0) {
    throw new CalcError("Logarithme invalide : ln(0) n'est pas défini.");
  }
  return cx(Math.log(cAbs(z)), cArgRad(z));
}

function cSqrt(z: Cx): Cx {
  if (z.im === 0) {
    return z.re >= 0 ? cx(Math.sqrt(z.re)) : cx(0, Math.sqrt(-z.re));
  }
  const r = cAbs(z);
  const re = Math.sqrt((r + z.re) / 2);
  const im = Math.sign(z.im) * Math.sqrt((r - z.re) / 2);
  return cx(re, im);
}

function cPowInt(base: Cx, n: number): Cx {
  let result = cx(1);
  let b = base;
  let e = Math.abs(n);
  while (e > 0) {
    if (e & 1) result = cMul(result, b);
    b = cMul(b, b);
    e = Math.floor(e / 2);
  }
  return n < 0 ? cDiv(cx(1), result) : result;
}

function cPow(a: Cx, b: Cx): Cx {
  if (a.re === 0 && a.im === 0) {
    if (b.re === 0 && b.im === 0) throw new CalcError("0⁰ n'est pas défini.");
    if (b.im === 0 && b.re < 0) throw new CalcError("Division par zéro.");
    return cx(0);
  }
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 1024) {
    return cPowInt(a, b.re);
  }
  return cExp(cMul(b, cLn(a)));
}

// ---------------------------------------------------------------------------
// Fonctions réelles
// ---------------------------------------------------------------------------

function toRad(x: number, mode: AngleMode) {
  return mode === "DEG" ? (x * Math.PI) / 180 : mode === "GRAD" ? (x * Math.PI) / 200 : x;
}
function fromRad(x: number, mode: AngleMode) {
  return mode === "DEG" ? (x * 180) / Math.PI : mode === "GRAD" ? (x * 200) / Math.PI : x;
}

/** sin/cos/tan avec valeurs exactes aux multiples de 90° (sin 180° = 0, pas 1,2e-16). */
function realTrig(fn: "sin" | "cos" | "tan", x: number, mode: AngleMode): number {
  if (Math.abs(x) > 1e15) throw new CalcError("Angle trop grand.");
  const quarter = mode === "DEG" ? 90 : mode === "GRAD" ? 100 : Math.PI / 2;
  const q = x / quarter;
  const r = Math.round(q);
  if (
    Math.abs(q - r) < 1e-10 * Math.max(1, Math.abs(q)) &&
    (r !== 0 || Math.abs(x) < 1e-15)
  ) {
    const n = ((r % 4) + 4) % 4;
    if (fn === "sin") return [0, 1, 0, -1][n];
    if (fn === "cos") return [1, 0, -1, 0][n];
    if (n % 2 === 1) throw new CalcError("tan n'est pas défini pour cet angle.");
    return 0;
  }
  const t = toRad(x, mode);
  return fn === "sin" ? Math.sin(t) : fn === "cos" ? Math.cos(t) : Math.tan(t);
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new CalcError("La factorielle n'existe que pour les entiers ≥ 0.");
  }
  if (n > 170) throw new CalcError("Résultat trop grand (n ≤ 170).");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function requireInt(x: number, name: string): number {
  if (!Number.isInteger(x) || Math.abs(x) > 9e15) {
    throw new CalcError(`${name} attend des entiers.`);
  }
  return x;
}

function gcd2(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function nCr(n: number, r: number): number {
  requireInt(n, "nCr");
  requireInt(r, "nCr");
  if (n < 0 || r < 0 || r > n) throw new CalcError("nCr : il faut 0 ≤ r ≤ n.");
  const k = Math.min(r, n - r);
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
  return res < Number.MAX_SAFE_INTEGER ? Math.round(res) : res;
}

function nPr(n: number, r: number): number {
  requireInt(n, "nPr");
  requireInt(r, "nPr");
  if (n < 0 || r < 0 || r > n) throw new CalcError("nPr : il faut 0 ≤ r ≤ n.");
  let res = 1;
  for (let i = 0; i < r; i++) res *= n - i;
  return res;
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function variance(xs: number[], sample: boolean) {
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  const d = sample ? xs.length - 1 : xs.length;
  if (d <= 0) throw new CalcError("Il faut au moins 2 valeurs pour un échantillon.");
  return ss / d;
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

type Ctx = EvalOptions & { vars: Record<string, number>; depth: number };

function realOf(z: Cx, name: string): number {
  if (z.im !== 0) throw new CalcError(`${name} n'accepte que des nombres réels.`);
  return z.re;
}

function checkFinite(z: Cx): Cx {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) {
    throw new CalcError("Résultat trop grand ou non défini.");
  }
  return z;
}

function powCx(a: Cx, b: Cx, ctx: Ctx): Cx {
  if (isReal(a) && isReal(b)) {
    const x = a.re;
    const y = b.re;
    if (x === 0 && y === 0) throw new CalcError("0⁰ n'est pas défini.");
    if (x === 0 && y < 0) throw new CalcError("Division par zéro.");
    if (x < 0 && !Number.isInteger(y)) {
      if (!ctx.complex) {
        throw new CalcError(
          "Puissance non réelle (base négative, exposant non entier). Utilise root(n, x) ou active ℂ."
        );
      }
      return checkFinite(cPow(a, b));
    }
    return checkFinite(cx(Math.pow(x, y)));
  }
  return checkFinite(cPow(a, b));
}

type FnDef = {
  min: number;
  max: number; // Infinity = variadique
  run: (args: Cx[], ctx: Ctx) => Cx;
};

function trig(fn: "sin" | "cos" | "tan"): FnDef["run"] {
  return ([z], ctx) => {
    if (isReal(z)) return cx(realTrig(fn, z.re, ctx.angle));
    if (!ctx.complex) throw new CalcError(`${fn} : argument complexe (active ℂ).`);
    const k = ctx.angle === "DEG" ? Math.PI / 180 : ctx.angle === "GRAD" ? Math.PI / 200 : 1;
    const w = cx(z.re * k, z.im * k);
    const sin = cx(Math.sin(w.re) * Math.cosh(w.im), Math.cos(w.re) * Math.sinh(w.im));
    const cos = cx(Math.cos(w.re) * Math.cosh(w.im), -Math.sin(w.re) * Math.sinh(w.im));
    return fn === "sin" ? sin : fn === "cos" ? cos : cDiv(sin, cos);
  };
}

function realOnly(name: string, f: (x: number, ctx: Ctx) => number): FnDef {
  return { min: 1, max: 1, run: ([z], ctx) => cx(f(realOf(z, name), ctx)) };
}

function statFn(name: string, f: (xs: number[]) => number): FnDef {
  return {
    min: 1,
    max: Infinity,
    run: (args) => cx(f(args.map((a) => realOf(a, name)))),
  };
}

const FUNCTIONS: Record<string, FnDef> = {
  sin: { min: 1, max: 1, run: trig("sin") },
  cos: { min: 1, max: 1, run: trig("cos") },
  tan: { min: 1, max: 1, run: trig("tan") },

  asin: realOnly("asin", (x, c) => {
    if (x < -1 || x > 1) throw new CalcError("asin : x doit être entre −1 et 1.");
    return fromRad(Math.asin(x), c.angle);
  }),
  acos: realOnly("acos", (x, c) => {
    if (x < -1 || x > 1) throw new CalcError("acos : x doit être entre −1 et 1.");
    return fromRad(Math.acos(x), c.angle);
  }),
  atan: realOnly("atan", (x, c) => fromRad(Math.atan(x), c.angle)),
  sinh: realOnly("sinh", (x) => Math.sinh(x)),
  cosh: realOnly("cosh", (x) => Math.cosh(x)),
  tanh: realOnly("tanh", (x) => Math.tanh(x)),

  exp: { min: 1, max: 1, run: ([z]) => checkFinite(cExp(z)) },
  ln: {
    min: 1,
    max: 1,
    run: ([z], ctx) => {
      if (isReal(z) && z.re > 0) return cx(Math.log(z.re));
      if (!ctx.complex) throw new CalcError("Logarithme invalide : x doit être > 0.");
      return cLn(z);
    },
  },
  log: {
    min: 1,
    max: 1,
    run: ([z], ctx) => {
      if (isReal(z) && z.re > 0) return cx(Math.log10(z.re));
      if (!ctx.complex) throw new CalcError("Logarithme invalide : x doit être > 0.");
      const l = cLn(z);
      return cx(l.re / Math.LN10, l.im / Math.LN10);
    },
  },
  logb: {
    min: 2,
    max: 2,
    run: ([b, x]) => {
      const base = realOf(b, "logb");
      const v = realOf(x, "logb");
      if (base <= 0 || base === 1) throw new CalcError("logb : base invalide.");
      if (v <= 0) throw new CalcError("Logarithme invalide : x doit être > 0.");
      return cx(Math.log(v) / Math.log(base));
    },
  },

  sqrt: {
    min: 1,
    max: 1,
    run: ([z], ctx) => {
      if (isReal(z) && z.re < 0 && !ctx.complex) {
        throw new CalcError("Racine invalide : x doit être ≥ 0 (active ℂ pour une racine complexe).");
      }
      return cSqrt(z);
    },
  },
  cbrt: realOnly("cbrt", (x) => Math.cbrt(x)),
  root: {
    min: 2,
    max: 2,
    run: ([nz, xz], ctx) => {
      const n = realOf(nz, "root");
      if (!Number.isInteger(n) || n === 0) {
        throw new CalcError("root(n, x) : n doit être un entier non nul.");
      }
      if (isReal(xz)) {
        const x = xz.re;
        if (x >= 0) return cx(Math.pow(x, 1 / n));
        if (Math.abs(n) % 2 === 1) return cx(-Math.pow(-x, 1 / n));
        if (!ctx.complex) {
          throw new CalcError("Racine invalide : racine paire d'un nombre négatif (active ℂ).");
        }
      }
      return cPow(xz, cx(1 / n));
    },
  },
  abs: { min: 1, max: 1, run: ([z]) => cx(cAbs(z)) },
  floor: realOnly("floor", (x) => Math.floor(x)),
  ceil: realOnly("ceil", (x) => Math.ceil(x)),
  round: realOnly("round", (x) => Math.round(x)),
  fact: realOnly("fact", (x) => factorial(x)),

  mod: {
    min: 2,
    max: 2,
    run: ([a, b]) => {
      const x = realOf(a, "mod");
      const y = realOf(b, "mod");
      if (y === 0) throw new CalcError("Modulo par zéro.");
      let r = x % y;
      if (r !== 0 && (r < 0) !== (y < 0)) r += y;
      return cx(r);
    },
  },
  gcd: {
    min: 2,
    max: Infinity,
    run: (args) =>
      cx(args.map((a) => requireInt(realOf(a, "pgcd"), "pgcd")).reduce(gcd2)),
  },
  lcm: {
    min: 2,
    max: Infinity,
    run: (args) => {
      const nums = args.map((a) => requireInt(realOf(a, "ppcm"), "ppcm"));
      if (nums.some((n) => n === 0)) return cx(0);
      const l = nums.reduce((a, b) => Math.abs((a / gcd2(a, b)) * b));
      if (!Number.isSafeInteger(l)) throw new CalcError("ppcm : résultat trop grand.");
      return cx(l);
    },
  },
  ncr: {
    min: 2,
    max: 2,
    run: ([n, r]) => cx(nCr(realOf(n, "nCr"), realOf(r, "nCr"))),
  },
  npr: {
    min: 2,
    max: 2,
    run: ([n, r]) => cx(nPr(realOf(n, "nPr"), realOf(r, "nPr"))),
  },

  // Nombres complexes
  re: { min: 1, max: 1, run: ([z]) => cx(z.re) },
  im: { min: 1, max: 1, run: ([z]) => cx(z.im) },
  conj: { min: 1, max: 1, run: ([z]) => cx(z.re, -z.im) },
  arg: {
    min: 1,
    max: 1,
    run: ([z], ctx) => {
      if (z.re === 0 && z.im === 0) throw new CalcError("arg(0) n'est pas défini.");
      return cx(fromRad(cArgRad(z), ctx.angle));
    },
  },

  // Statistiques (population = σ, échantillon = s)
  sum: statFn("sum", (xs) => xs.reduce((a, b) => a + b, 0)),
  mean: statFn("mean", mean),
  median: statFn("median", median),
  var: statFn("var", (xs) => variance(xs, false)),
  std: statFn("std", (xs) => Math.sqrt(variance(xs, false))),
  svar: statFn("svar", (xs) => variance(xs, true)),
  sstd: statFn("sstd", (xs) => Math.sqrt(variance(xs, true))),
  min: statFn("min", (xs) => Math.min(...xs)),
  max: statFn("max", (xs) => Math.max(...xs)),
};

const ALIASES: Record<string, string> = {
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  pgcd: "gcd",
  ppcm: "lcm",
  comb: "ncr",
  perm: "npr",
  factorielle: "fact",
  moyenne: "mean",
  mediane: "median",
  somme: "sum",
  variance: "var",
  racine: "sqrt",
  module: "abs",
  conjugue: "conj",
};

const CONSTANT_NAMES = new Set(["pi", "e", "i", "ans"]);

function resolveSymbol(name: string, ctx: Ctx): Cx {
  if (name === "pi") return cx(Math.PI);
  if (name === "e") return cx(Math.E);
  if (name === "i") {
    if (!ctx.complex) {
      throw new CalcError("i est l'unité imaginaire : active le mode ℂ pour l'utiliser.");
    }
    return cx(0, 1);
  }
  if (name === "ans") {
    if (ctx.ans === undefined) throw new CalcError("Aucun résultat précédent (ans).");
    return typeof ctx.ans === "number" ? cx(ctx.ans) : ctx.ans;
  }
  if (Object.prototype.hasOwnProperty.call(ctx.vars, name)) return cx(ctx.vars[name]);

  const fnName = ALIASES[name] ?? name;
  if (Object.prototype.hasOwnProperty.call(FUNCTIONS, fnName)) {
    throw new CalcError(`${name} doit être suivi de parenthèses, par ex. ${name}(x).`);
  }

  // Produit de symboles collés (« xy », « ex ») : x·y, e·x…
  const known = [...CONSTANT_NAMES, ...Object.keys(ctx.vars)].sort(
    (a, b) => b.length - a.length
  );
  const parts: string[] = [];
  let rest = name;
  while (rest.length > 0) {
    const hit = known.find((k) => rest.startsWith(k));
    if (!hit) throw new CalcError(`Symbole inconnu : « ${name} »`);
    parts.push(hit);
    rest = rest.slice(hit.length);
  }
  if (parts.length > 1) {
    return parts.map((p) => resolveSymbol(p, ctx)).reduce(cMul);
  }
  throw new CalcError(`Symbole inconnu : « ${name} »`);
}

function evalNode(n: Node, ctx: Ctx): Cx {
  switch (n.k) {
    case "num":
      return cx(n.v);

    case "sym":
      return resolveSymbol(n.name, ctx);

    case "neg": {
      const a = evalNode(n.a, ctx);
      return cx(-a.re, a.im === 0 ? 0 : -a.im);
    }

    case "bin": {
      const a = evalNode(n.a, ctx);
      const b = evalNode(n.b, ctx);
      switch (n.op) {
        case "+":
          return cAdd(a, b);
        case "-":
          return cSub(a, b);
        case "*":
          return checkFinite(cMul(a, b));
        case "/":
          return checkFinite(cDiv(a, b));
        case "^":
          return powCx(a, b, ctx);
      }
      break;
    }

    case "pct": {
      const base = evalNode(n.a, ctx);
      const p = evalNode(n.b, ctx);
      const delta = cx((base.re * p.re) / 100, (base.im * p.re) / 100);
      return n.sign === 1 ? cAdd(base, delta) : cSub(base, delta);
    }

    case "post": {
      const a = evalNode(n.a, ctx);
      switch (n.op) {
        case "!":
          return cx(factorial(realOf(a, "n!")));
        case "%":
          return cx(a.re / 100, a.im / 100);
        case "²":
          return checkFinite(cMul(a, a));
        case "³":
          return checkFinite(cMul(cMul(a, a), a));
      }
      break;
    }

    case "fn": {
      const name = ALIASES[n.name] ?? n.name;
      if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
        throw new CalcError(`Fonction inconnue : « ${n.name} »`);
      }
      const def = FUNCTIONS[name];
      if (n.args.length < def.min || n.args.length > def.max) {
        const attendu =
          def.max === Infinity
            ? `au moins ${def.min} argument${def.min > 1 ? "s" : ""}`
            : def.min === def.max
              ? `${def.min} argument${def.min > 1 ? "s" : ""}`
              : `${def.min} à ${def.max} arguments`;
        throw new CalcError(`${n.name} attend ${attendu}.`);
      }
      const args = n.args.map((a) => evalNode(a, ctx));
      return checkFinite(def.run(args, ctx));
    }
  }
  throw new CalcError("Expression invalide.");
}

function makeCtx(opts: EvalOptions): Ctx {
  return { ...opts, vars: { ...(opts.vars ?? {}) }, depth: 0 };
}

function finalize(z: Cx, ctx: Ctx): Cx {
  const s = snap(checkFinite(z));
  const out = { re: clean(s.re), im: clean(s.im) };
  if (out.im !== 0 && !ctx.complex) {
    throw new CalcError("Résultat complexe : active le mode ℂ.");
  }
  return out;
}

/** Évalue une expression. Lève CalcError avec un message lisible en cas de problème. */
export function evaluate(expression: string, opts: EvalOptions): Cx {
  const ctx = makeCtx(opts);
  return finalize(evalNode(parse(expression), ctx), ctx);
}

/** Évalue une expression dont le résultat doit être réel. */
export function evaluateReal(expression: string, opts: Partial<EvalOptions> = {}): number {
  const full: EvalOptions = { angle: "RAD", complex: false, ...opts };
  return evaluate(expression, { ...full, complex: false }).re;
}

/**
 * Analyse l'expression UNE fois et renvoie une fonction rapide à
 * ré-évaluer avec d'autres valeurs (dérivée, intégrale, tableaux…).
 */
export function compile(
  expression: string,
  opts: EvalOptions
): (vars: Record<string, number>) => number {
  const tree = parse(expression);
  return (vars) => {
    const ctx = makeCtx({ ...opts, complex: false, vars: { ...(opts.vars ?? {}), ...vars } });
    const z = finalize(evalNode(tree, ctx), ctx);
    return z.re;
  };
}
