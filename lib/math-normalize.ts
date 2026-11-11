// Normalisation PRUDENTE de la notation mathématique dans le texte pédagogique
// renvoyé par l'IA (cahier des charges §9).
//
//   sqrt(2)        → √2          \sqrt{2}        → √2
//   sqrt(x+1)      → √(x+1)      \sqrt{x+1}      → √(x+1)
//   \sqrt[3]{8}    → ∛8          \sqrt[5]{x}     → ⁵√x
//
// JAMAIS transformé (le code doit rester exécutable) :
//   - blocs de code ``` … ``` (y compris un bloc non refermé) ;
//   - code inline `math.sqrt(2)` ;
//   - appels de fonction d'un langage, même hors backticks :
//     math.sqrt(2), Math.sqrt(2), np.sqrt(x), std::sqrt(x), isqrt(9), SQRT(A1)…
//     (on ne convertit que « sqrt( » isolé, en minuscules) ;
//   - sqrt(a, b) : deux arguments = fonction de code, pas une racine.
//
// Module pur (aucune dépendance) : utilisable côté serveur ET navigateur.

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

/** Index (0-based) de la parenthèse/accolade fermante qui équilibre celle en `open`, ou -1. */
function findMatching(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Vrai s'il existe une virgule hors de toute parenthèse (→ appel de fonction à plusieurs arguments). */
function hasTopLevelComma(arg: string): boolean {
  let depth = 0;
  for (const c of arg) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return true;
  }
  return false;
}

const SIMPLE_RADICAND = /^(?:\d+(?:[.,]\d+)?|[A-Za-zα-ωΑ-Ω])$/u;

/** « 2 » → « 2 », « x+1 » → « (x+1) », « (x+1) » → « (x+1) » : jamais de double parenthèse. */
function formatRadicand(arg: string): string {
  const a = arg.trim();
  if (SIMPLE_RADICAND.test(a)) return a;
  if (a.startsWith("(") && findMatching(a, 0, "(", ")") === a.length - 1) return a;
  return `(${a})`;
}

function rootSymbol(index: string | null): string | null {
  if (index === null) return "√";
  const n = index.trim();
  if (n === "2") return "√";
  if (n === "3") return "∛";
  if (n === "4") return "∜";
  if (/^\d+$/.test(n)) return [...n].map((d) => SUPERSCRIPT[d]).join("") + "√";
  if (n === "n") return "ⁿ√";
  return null; // indice inhabituel : on laisse tel quel plutôt que de deviner
}

/** \sqrt{…}, \sqrt[n]{…}, \sqrt2 → √… (récursif pour les racines imbriquées). */
function convertLatexRoots(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("\\sqrt", i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    let j = at + "\\sqrt".length;
    // Ne pas confondre avec une autre commande (\sqrtfoo).
    if (/[A-Za-z]/.test(text[j] ?? "")) {
      out += text.slice(at, j);
      i = j;
      continue;
    }
    while (text[j] === " ") j++;

    let index: string | null = null;
    if (text[j] === "[") {
      const close = text.indexOf("]", j);
      if (close === -1) {
        out += text.slice(at, j);
        i = j;
        continue;
      }
      index = text.slice(j + 1, close);
      j = close + 1;
      while (text[j] === " ") j++;
    }

    let radicand: string | null = null;
    let end = j;
    if (text[j] === "{") {
      const close = findMatching(text, j, "{", "}");
      if (close !== -1) {
        radicand = text.slice(j + 1, close);
        end = close + 1;
      }
    } else {
      const m = /^(\d+(?:[.,]\d+)?|[A-Za-zα-ωΑ-Ω])/u.exec(text.slice(j));
      if (m) {
        radicand = m[1];
        end = j + m[1].length;
      }
    }

    const symbol = rootSymbol(index);
    if (radicand === null || radicand.trim() === "" || symbol === null) {
      out += text.slice(at, Math.max(end, at + "\\sqrt".length));
      i = Math.max(end, at + "\\sqrt".length);
      continue;
    }

    out += symbol + formatRadicand(normalizeRootsInProse(radicand));
    i = end;
  }
  return out;
}

/**
 * `sqrt(` à la position `at` est-il un APPEL DE CODE (math.sqrt, np.sqrt, std::sqrt,
 * isqrt, my_sqrt, x3sqrt…) ? Un coefficient numérique collé (« 3sqrt(2) », « 2.5sqrt(3) »)
 * reste de la prose mathématique.
 */
function isCodeContext(text: string, at: number): boolean {
  const prev = at > 0 ? text[at - 1] : "";
  if (prev === "") return false;
  if (/[A-Za-z_$.:\\]/.test(prev)) return true;
  if (/[0-9]/.test(prev)) {
    let i = at - 1;
    while (i >= 0 && /[0-9]/.test(text[i])) i--;
    // coefficient décimal : 2.5sqrt(3)
    if (i >= 1 && (text[i] === "." || text[i] === ",") && /[0-9]/.test(text[i - 1])) {
      i--;
      while (i >= 0 && /[0-9]/.test(text[i])) i--;
    }
    const before = i >= 0 ? text[i] : "";
    return /[A-Za-z_$.]/.test(before); // « x3sqrt( » = identifiant
  }
  return false;
}

/** sqrt(…) isolé → √… (jamais après un « . », « :: », un identifiant ou un « $ »). */
function convertPlainRoots(text: string): string {
  let out = "";
  let i = 0;
  const marker = "sqrt(";
  while (i < text.length) {
    const at = text.indexOf(marker, i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    const openIdx = at + marker.length - 1;
    const close = findMatching(text, openIdx, "(", ")");
    const isCodeCall = isCodeContext(text, at);
    const arg = close === -1 ? "" : text.slice(openIdx + 1, close);

    if (isCodeCall || close === -1 || arg.trim() === "" || hasTopLevelComma(arg)) {
      out += text.slice(i, at + marker.length);
      i = at + marker.length;
      continue;
    }

    out += text.slice(i, at) + "√" + formatRadicand(normalizeRootsInProse(arg));
    i = close + 1;
  }
  return out;
}

/** Convertit les racines d'un fragment de PROSE (aucun code ici). */
function normalizeRootsInProse(text: string): string {
  if (!text.includes("sqrt")) return text;
  return convertPlainRoots(convertLatexRoots(text));
}

/** Découpe hors blocs ``` (un bloc non refermé va jusqu'à la fin) puis hors `code inline`. */
export function normalizeMathNotation(input: string): string {
  if (!input || !input.includes("sqrt")) return input;

  const fenceSplit = input.split(/(```[\s\S]*?(?:```|$))/g);
  return fenceSplit
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk; // bloc de code : intact
      return chunk
        .split(/(`[^`\n]*`)/g)
        .map((part, k) => (k % 2 === 1 ? part : normalizeRootsInProse(part)))
        .join("");
    })
    .join("");
}
