// Lecture sécurisée des réponses JSON de Gemini pour le professeur IA. Fonctions pures, sans dépendance.
// Le modèle ne décide JAMAIS seul de l'avancement : le serveur applique `shouldAdvance` ci-dessous.

export type Verdict = "correct" | "partial" | "incorrect" | "unclear";
const VERDICTS: readonly Verdict[] = ["correct", "partial", "incorrect", "unclear"];

export function extractJson(raw: string): unknown | null {
  let t = String(raw ?? "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type TeachOut = { explanation: string; question: string; paragraphLang: string };
export function parseTeach(raw: string): TeachOut | null {
  const j = extractJson(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const explanation = str(j.explanation, 3000);
  const question = str(j.question, 600);
  if (!explanation || !question) return null;
  // Code de langue du paragraphe (ex. « fr ») : sert à choisir la voix de lecture ; vide si absent/invalide.
  const pl = str(j.paragraphLang, 8).toLowerCase();
  return { explanation, question, paragraphLang: /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(pl) ? pl : "" };
}

export type EvalOut = { verdict: Verdict; feedback: string; example: string; nextQuestion: string };
export function parseEval(raw: string): EvalOut | null {
  const j = extractJson(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const verdict = typeof j.verdict === "string" ? (j.verdict.trim().toLowerCase() as Verdict) : ("" as Verdict);
  if (!VERDICTS.includes(verdict)) return null;
  const feedback = str(j.feedback, 2500);
  if (!feedback) return null;
  return { verdict, feedback, example: str(j.example, 1200), nextQuestion: str(j.nextQuestion, 600) };
}

export type FinalOut = { summary: string; keyNotions: string[]; quiz: { question: string; answer: string }[] };
export function parseFinal(raw: string): FinalOut | null {
  const j = extractJson(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const summary = str(j.summary, 3500);
  const keyNotions = Array.isArray(j.keyNotions) ? j.keyNotions.map((x) => str(x, 300)).filter(Boolean).slice(0, 10) : [];
  const quiz = Array.isArray(j.quiz)
    ? j.quiz
        .map((q) => {
          const o = (q ?? {}) as Record<string, unknown>;
          return { question: str(o.question, 400), answer: str(o.answer, 600) };
        })
        .filter((q) => q.question && q.answer)
        .slice(0, 5)
    : [];
  if (!summary || quiz.length === 0) return null;
  return { summary, keyNotions, quiz };
}

/** L'élève ne passe au paragraphe suivant QUE si sa réponse est jugée correcte. */
export function shouldAdvance(verdict: Verdict): boolean {
  return verdict === "correct";
}

/**
 * Une réponse « unclear » (ambiguë) ne compte pas comme une erreur : on demande une clarification
 * sans pénaliser l'élève. Les autres réponses non correctes comptent comme une tentative.
 */
export function attemptsAfter(prev: number, verdict: Verdict): number {
  if (verdict === "correct") return 0;
  if (verdict === "unclear") return prev;
  return prev + 1;
}

/** Après ce nombre de tentatives non correctes, l'IA reformule avec une approche différente. */
export const REFORMULATE_AFTER_ATTEMPTS = 2;
