// Explications VISUELLES : schémas pédagogiques annotés (SVG) générés par l'IA. SERVEUR UNIQUEMENT.
//
// Le SVG est un TEXTE produit par un modèle : il n'est jamais inséré tel quel dans la page.
// Défense en profondeur :
//   1. sanitizeSvg() refuse tout SVG contenant script, gestionnaire d'événement, foreignObject,
//      lien externe, image distante, balise de style importée ou URL javascript: / data: HTML ;
//   2. le navigateur l'affiche via <img src="data:image/svg+xml…"> : dans ce mode un SVG
//      n'exécute AUCUN script et ne charge AUCUNE ressource externe.



export const MAX_SVG_CHARS = 60_000;

export const VISUAL_SYSTEM_PROMPT = `Tu es le module « Explication visuelle » de Study Helper. Tu crées UN schéma pédagogique en SVG qui DÉMONTRE un phénomène, pour un apprenant.

RÈGLES DU SVG :
- Réponds UNIQUEMENT avec le code SVG (de <svg> à </svg>), sans texte avant ni après, sans bloc markdown.
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"> ; fond clair (rect blanc plein), police sans-serif, texte lisible (taille ≥ 16).
- Le schéma doit être UTILE pédagogiquement, pas décoratif : éléments clés dessinés clairement, FLÈCHES (utilise <defs><marker> pour les pointes), ÉTAPES NUMÉROTÉES (cercles 1, 2, 3…), LÉGENDES et ANNOTATIONS courtes, titre en haut.
- Si le phénomène évolue dans le temps (forces, cycle, réaction, circulation…), montre-le étape par étape avec des numéros et des flèches.
- Mathématiques : figures géométriques et graphes de fonctions avec axes gradués et points nommés. Astronomie : orbites et positions. Biologie : organes/cellules annotés. Chimie : atomes/molécules et flèches de réaction. Géographie : relief/cartes simplifiées légendées.
- Tous les textes visibles du schéma (titre, légendes, étiquettes, étapes) sont écrits dans la langue cible (TARGET LANGUAGE), même si le sujet ou le cours est dans une autre langue.
- INTERDIT : <script>, <style> importé, <foreignObject>, <image>, <a>, attributs on*, href/xlink:href, url(http…), liens, données externes. Uniquement formes, chemins, texte, groupes, dégradés internes.
- Reste simple et lisible sur un écran de téléphone : pas plus d'environ 25 éléments textuels.`;

/** Extrait le <svg>…</svg> d'une réponse (retire d'éventuels blocs markdown). */
export function extractSvg(raw: string): string | null {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  return m ? m[0].trim() : null;
}

const FORBIDDEN: RegExp[] = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /<\s*image\b/i,
  /<\s*a[\s>]/i,
  /<\s*use\b[^>]*href/i,
  /<\s*animate/i,
  /<\s*set\b/i,
  /\son[a-z]+\s*=/i, // onload=, onclick=…
  /\b(?:xlink:)?href\s*=/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /url\(\s*['"]?\s*(?:https?:|\/\/|data:)/i,
  /@import/i,
  /<!ENTITY/i,
  /<!DOCTYPE/i,
];

export type SvgCheck = { ok: true; svg: string } | { ok: false; reason: string };

export function sanitizeSvg(raw: string): SvgCheck {
  const svg = extractSvg(raw);
  if (!svg) return { ok: false, reason: "no_svg" };
  if (svg.length > MAX_SVG_CHARS) return { ok: false, reason: "too_large" };
  for (const re of FORBIDDEN) if (re.test(svg)) return { ok: false, reason: "forbidden_content" };
  let out = svg;
  if (!/<svg[^>]*\sxmlns\s*=/i.test(out)) out = out.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/<svg[^>]*\sviewBox\s*=/i.test(out)) out = out.replace(/<svg/i, '<svg viewBox="0 0 800 520"');
  return { ok: true, svg: out };
}
