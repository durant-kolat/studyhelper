// Filet de sécurité : transforme tout LaTeX résiduel en symboles Unicode lisibles.
// Study Helper n'a pas de moteur LaTeX (KaTeX) : un « $$√48$$ » ou « \sqrt{48} » s'afficherait tel quel.
// Les blocs de code (``` … ``` et `…`) ne sont JAMAIS modifiés. Serveur ou client, sans dépendance.

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "n": "ⁿ", "x": "ˣ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };
const mapAll = (s: string, m: Record<string, string>) => (s.split("").every((c) => c in m) ? s.split("").map((c) => m[c]).join("") : null);

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  infty: "∞", pi: "π", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ",
  sigma: "σ", Sigma: "Σ", omega: "ω", Omega: "Ω", phi: "φ", rho: "ρ", tau: "τ", eta: "η", nu: "ν", kappa: "κ",
  rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", leftrightarrow: "↔", implies: "⇒", iff: "⇔",
  in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", forall: "∀", exists: "∃", emptyset: "∅", degree: "°", circ: "°",
  ldots: "…", dots: "…", cdots: "…", sum: "∑", prod: "∏", int: "∫", partial: "∂", nabla: "∇", angle: "∠", perp: "⊥", parallel: "∥",
  hbar: "ħ", sim: "∼", propto: "∝", ll: "≪", gg: "≫",
};

/** Contenu simple (un seul « atome ») : pas besoin de parenthèses. */
const isAtom = (s: string) => /^[\p{L}\p{N}.]+$/u.test(s);
const paren = (s: string) => (isAtom(s) ? s : `(${s})`);

/** Extrait un groupe {…} équilibré à partir de `i` (s[i] === "{"). */
function group(s: string, i: number): { text: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

function convertLatex(input: string): string {
  let s = input;
  // \text{..}, \mathrm{..}, \mathbf{..}, \operatorname{..} → contenu
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|textbf|operatorname|mathbb|mathcal)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])\s*/g, "");
  s = s.replace(/\\[,;:!]/g, " ").replace(/\\(?:quad|qquad)(?![a-zA-Z])/g, " ");
  // \sqrt[n]{x} et \sqrt{x} : on traite la DERNIÈRE occurrence en premier (la plus imbriquée)
  for (let guard = 0; guard < 50; guard++) {
    const idx = s.lastIndexOf("\\sqrt");
    if (idx < 0) break;
    let j = idx + 5;
    while (s[j] === " ") j++;
    let n = "";
    if (s[j] === "[") {
      const close = s.indexOf("]", j);
      if (close < 0) break;
      n = s.slice(j + 1, close).trim();
      j = close + 1;
      while (s[j] === " ") j++;
    }
    const g = group(s, j);
    if (!g) {
      // \sqrt sans accolades (ex. \sqrt2) : traité plus bas
      s = s.slice(0, idx) + "\u0001" + s.slice(idx + 5);
      continue;
    }
    const body = isAtom(g.text.trim()) ? g.text.trim() : `(${g.text.trim()})`;
    const pre = n === "" || n === "2" ? "√" : n === "3" ? "∛" : n === "4" ? "∜" : `${mapAll(n, SUP) ?? `^(${n})`}√`;
    s = s.slice(0, idx) + pre + body + s.slice(g.end);
  }
  s = s.replace(/\u0001\s*([\p{L}\p{N}])/gu, "√$1").replace(/\u0001/g, "√");
  s = s.replace(/\\sqrt\s*([\p{L}\p{N}])/gu, "√$1");
  for (let pass = 0; pass < 6; pass++) {
    const before = s;
    s = s.replace(/\\[dt]?frac\s*\{([^{}\\]*)\}\s*\{([^{}\\]*)\}/g, (_m, a: string, b: string) => `${paren(a.trim())}/${paren(b.trim())}`);
    s = s.replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, "$1/$2");
    if (s === before) break;
  }
  // puissances / indices
  s = s.replace(/\^\{([^{}]*)\}/g, (m, e: string) => mapAll(e.trim(), SUP) ?? `^(${e.trim()})`);
  s = s.replace(/\^([0-9nx+-])/g, (_m, e: string) => SUP[e] ?? `^${e}`);
  s = s.replace(/_\{([^{}]*)\}/g, (m, e: string) => mapAll(e.trim(), SUB) ?? `_(${e.trim()})`);
  s = s.replace(/_([0-9])/g, (_m, e: string) => SUB[e]);
  // symboles
  s = s.replace(/\\([a-zA-Z]+)/g, (m, name: string) => SYMBOLS[name] ?? m);
  s = s.replace(/\\%/g, "%").replace(/\\&/g, "&").replace(/\\\$/g, "$").replace(/\\\\/g, "\n");
  return s;
}

function convertPlain(text: string): string {
  let s = text;
  // Blocs mathématiques : $$…$$, \[…\], \(…\)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => convertLatex(inner.trim()));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => convertLatex(inner.trim()));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => convertLatex(inner.trim()));
  // $…$ en ligne : uniquement si le contenu ressemble à des maths (évite « 5 $ et 6 $ »)
  s = s.replace(/(?<![\\$\p{N}])\$(?!\s)([^$\n]{1,200}?)(?<!\s)\$(?![\p{N}$])/gu, (m, inner: string) =>
    /[\\^_{}=+\-*/<>√]|[a-zA-Z]\s*\(|\d/.test(inner) && !/^\d+([.,]\d+)?$/.test(inner) ? convertLatex(inner) : m,
  );
  // Commandes LaTeX isolées restantes
  if (/\\(?:sqrt|frac|dfrac|tfrac|times|cdot|pm|leq|geq|neq|approx|infty|pi|alpha|beta|theta|lambda|Delta|rightarrow|to|text|left|right)\b/.test(s)) s = convertLatex(s);
  return s;
}

/** Texte libre (Markdown) : le code est préservé. */
export function normalizeMathText(text: string): string {
  if (!text || !/[$\\^_]/.test(text)) return text;
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : convertPlain(part)))
    .join("");
}

/** Réponse JSON : on transforme chaque chaîne SANS toucher à la structure. Si le JSON est invalide, on rend le texte tel quel. */
export function normalizeMathJson(raw: string): string {
  if (!raw || !/[$\\^_]/.test(raw)) return raw;
  try {
    const walk = (v: unknown): unknown =>
      typeof v === "string" ? normalizeMathText(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
    return JSON.stringify(walk(JSON.parse(raw)));
  } catch {
    return raw;
  }
}
