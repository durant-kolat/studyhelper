// Découpage d'un cours en paragraphes d'étude, DANS L'ORDRE D'ORIGINE. Fonction pure et déterministe :
// le même texte donne toujours les mêmes paragraphes, donc la progression sauvegardée (index) reste
// valable sans recopier le cours dans une nouvelle table. Aucune dépendance (testable seule).

export type ParagraphLimits = {
  /** Texte du cours pris en compte au maximum (caractères). Au-delà : tronqué, l'utilisateur en est informé. */
  maxDocChars: number;
  /** Nombre maximum de paragraphes d'une séance. */
  maxParagraphs: number;
  /** Taille cible maximale d'un paragraphe (un très long bloc est coupé aux fins de phrases). */
  maxParagraphChars: number;
  /** Les fragments plus courts que ceci (titres, puces) sont fusionnés avec le suivant. */
  minParagraphChars: number;
};

export const DEFAULT_PARAGRAPH_LIMITS: ParagraphLimits = {
  maxDocChars: 40_000,
  maxParagraphs: 60,
  maxParagraphChars: 900,
  minParagraphChars: 80,
};

export type ParagraphResult = { paragraphs: string[]; truncated: boolean };

function splitLongBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  // Coupe aux fins de phrase ; à défaut, aux espaces.
  const sentences = block.match(/[^.!?。！？؟\n]+[.!?。！？؟]+["»”)]*\s*|[^.!?。！？؟\n]+$/g) ?? [block];
  const out: string[] = [];
  let cur = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if ((cur + " " + sentence).trim().length > max && cur) {
      out.push(cur.trim());
      cur = sentence;
    } else {
      cur = (cur + " " + sentence).trim();
    }
    while (cur.length > max * 1.5) {
      // Phrase unique démesurée : coupe dure à un espace.
      const cut = cur.lastIndexOf(" ", max);
      const at = cut > max * 0.5 ? cut : max;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at).trim();
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function splitIntoParagraphs(text: string, limits: Partial<ParagraphLimits> = {}): ParagraphResult {
  const L = { ...DEFAULT_PARAGRAPH_LIMITS, ...limits };
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n");
  let truncated = false;
  let source = normalized;
  if (source.length > L.maxDocChars) {
    source = source.slice(0, L.maxDocChars);
    truncated = true;
  }

  // 1) Blocs séparés par une ligne vide ; à défaut de lignes vides, par retour à la ligne.
  let blocks = source.split(/\n\s*\n+/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  if (blocks.length <= 1 && source.includes("\n")) {
    blocks = source.split(/\n+/).map((b) => b.trim()).filter(Boolean);
  }

  // 2) Coupe les blocs trop longs.
  const pieces = blocks.flatMap((b) => splitLongBlock(b, L.maxParagraphChars));

  // 3) Fusionne les fragments trop courts avec le suivant (un titre reste avec son paragraphe).
  const merged: string[] = [];
  let carry = "";
  for (const piece of pieces) {
    const candidate = carry ? `${carry}\n${piece}` : piece;
    if (candidate.length < L.minParagraphChars) {
      carry = candidate;
    } else {
      merged.push(candidate);
      carry = "";
    }
  }
  if (carry) {
    if (merged.length) merged[merged.length - 1] += `\n${carry}`;
    else merged.push(carry);
  }

  if (merged.length > L.maxParagraphs) {
    truncated = true;
    return { paragraphs: merged.slice(0, L.maxParagraphs), truncated };
  }
  return { paragraphs: merged, truncated };
}
