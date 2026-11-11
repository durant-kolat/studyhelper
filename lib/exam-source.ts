// Matière première d'un examen « à partir d'un cours » (fichier importé, photos de la caméra ou cours de la bibliothèque).
// Logique PURE (sans dépendance) : le serveur construit le bloc de données envoyé à l'IA, sans jamais rien inventer.

export const MAX_COURSE_CHARS = 14_000; // volume borné : coût maîtrisé, prompt sûr
export const MIN_COURSE_CHARS = 50;
export const MIN_NOTIONS = 3;

export type CourseMaterial = { text: string; truncated: boolean; usable: boolean; chars: number };

const cleanNotion = (n: unknown) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/** Texte du cours + notions clés, borné. `usable` = assez de matière réelle pour fonder un examen (jamais de questions « dans le vide »). */
export function courseMaterial(course: { content_text?: string | null; key_notions?: unknown }): CourseMaterial {
  const notions = (Array.isArray(course.key_notions) ? course.key_notions : []).map(cleanNotion).filter(Boolean).slice(0, 30);
  const raw = typeof course.content_text === "string" ? course.content_text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  let content = raw;
  let truncated = false;
  if (content.length > MAX_COURSE_CHARS) {
    truncated = true;
    const cut = content.slice(0, MAX_COURSE_CHARS);
    const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf(" "));
    content = lastBreak > MAX_COURSE_CHARS * 0.8 ? cut.slice(0, lastBreak) : cut;
  }
  const parts: string[] = [];
  if (notions.length > 0) parts.push(`Notions clés repérées :\n${notions.map((n) => `- ${n}`).join("\n")}`);
  if (content) parts.push(`Contenu du cours :\n${content}`);
  const usable = raw.length >= MIN_COURSE_CHARS || notions.length >= MIN_NOTIONS;
  return { text: parts.join("\n\n"), truncated, usable, chars: raw.length };
}

export const COURSE_EXAM_RULES =
  "Base-toi UNIQUEMENT sur ce cours : chaque question doit pouvoir être justifiée par le contenu fourni. " +
  "Ne pose aucune question sur un sujet absent du cours et n'invente aucune définition, formule ou donnée qui n'y figure pas. " +
  "Répartis les questions sur l'ensemble du contenu fourni.";
