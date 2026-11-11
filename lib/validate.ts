import { z } from "zod";
import { DIFFICULTIES } from "./adaptive";

// Limites choisies pour rester largement suffisantes pour un usage
// normal tout en empêchant un payload abusif (coût IA, mémoire, temps
// de traitement) — voir l'audit sécurité, point "validation stricte".

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

export const chatHistorySchema = z.array(chatMessageSchema).max(30);

export const difficultySchema = z.enum(DIFFICULTIES);

export const assistantModeSchema = z.enum([
  "chat",
  "question",
  "exercise",
  "series",
  "quiz",
  "revise",
]);

// `chat` : message libre. Les autres modes sont des actions guidées de
// l'interface (question, exercice, série, quiz, révision) : le serveur
// construit lui-même la consigne à partir de ces champs validés.
export const assistantPayloadSchema = z
  .object({
    message: z.string().max(4000).optional().default(""),
    history: chatHistorySchema.optional().default([]),
    mode: assistantModeSchema.optional().default("chat"),
    difficulty: difficultySchema.optional().default("intermediaire"),
    subject: z.string().max(100).optional(),
    chapter: z.string().max(120).optional(),
    courseId: z.string().uuid().optional(),
    count: z.number().int().min(1).max(10).optional(),
    /** Langue actuellement sélectionnée dans l'application (preferredLanguage). */
    language: z.string().max(10).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "chat" && value.message.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Écris ta question avant d'envoyer.",
      });
    }
  });

export const careerCvPayloadSchema = z.object({
  fullName: z.string().min(1).max(200),
  targetRole: z.string().min(1).max(200),
  email: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  location: z.string().max(100).optional(),
  education: z.string().max(2000).optional(),
  experience: z.string().max(2000).optional(),
  skills: z.string().max(1000).optional(),
});

export const careerLetterPayloadSchema = z.object({
  fullName: z.string().min(1).max(200),
  targetRole: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  strengths: z.string().max(2000).optional(),
});

export const careerInterviewPayloadSchema = z.object({
  targetRole: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  history: chatHistorySchema.optional().default([]),
});

export const careerOrientationPayloadSchema = z.object({
  favoriteSubjects: z.string().min(1).max(500),
  interests: z.string().max(1000).optional(),
  skills: z.string().max(1000).optional(),
  constraints: z.string().max(1000).optional(),
});

export const studyLevelSchema = z.enum([
  "primaire",
  "college",
  "lycee",
  "universite",
  "formation_pro",
]);

export const generateExamPayloadSchema = z.object({
  subject: z.string().min(1).max(100),
  chapter: z.string().max(120).optional(),
  level: studyLevelSchema.optional(),
  difficulty: difficultySchema.optional(),
  questionCount: z.number().int().min(5).max(50).optional(),
  durationMinutes: z.number().int().min(10).max(120).optional(),
  // Examen fondé sur UN cours précis (importé, filmé ou choisi dans la bibliothèque).
  courseId: z.string().uuid().optional(),
  // Partie B : nombre de questions rédigées / à schéma (0 = QCM seulement).
  openCount: z.number().int().min(0).max(5).optional(),
});

export const submitAnswersPayloadSchema = z.object({
  examId: z.string().uuid(),
  answers: z.array(z.number().int()).max(50),
  // Partie B : texte de la réponse et/ou photos (chemins du bucket privé, revalidés côté serveur).
  openAnswers: z
    .array(
      z.object({
        index: z.number().int().min(0).max(9),
        text: z.string().max(6000).optional(),
        imagePaths: z.array(z.string().max(300)).max(3).optional(),
      })
    )
    .max(5)
    .optional(),
});

/**
 * Parse et valide `body` avec `schema`. Retourne les données typées si
 * valide, ou une réponse d'erreur 400 prête à renvoyer sinon — évite de
 * répéter le try/catch de validation dans chaque route.
 */
export function parseOrError<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "Requête invalide." };
  }
  return { ok: true, data: result.data };
}

// ============================================================
// Validation des réponses générées par l'IA (Gemini) — une réponse
// malformée (JSON valide mais structure inattendue) ne doit jamais
// être stockée/servie telle quelle.
// ============================================================

export const examQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  method: z.string().min(1),
});

export const examQuestionsSchema = z.array(examQuestionSchema).min(1).max(20);

export const quizQuestionSchema = examQuestionSchema.extend({
  subject: z.string().min(1),
});

export const quizQuestionsSchema = z.array(quizQuestionSchema).min(1).max(30);

export const courseAnalysisSchema = z.object({
  summary: z.string().min(1),
  key_points: z.array(z.string().min(1)).max(20),
  questions: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .max(20),
});

export const cvDataSchema = z.object({
  fullName: z.string().min(1),
  targetRole: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  tagline: z.string().min(1),
  education: z
    .array(z.object({ period: z.string(), title: z.string().min(1), detail: z.string() }))
    .max(20),
  experience: z
    .array(z.object({ period: z.string(), title: z.string().min(1), detail: z.string() }))
    .max(20),
  skills: z.array(z.string().min(1)).max(30),
});

export const orientationPathsSchema = z.object({
  paths: z
    .array(
      z.object({
        title: z.string().min(1),
        why: z.string().min(1),
        next_steps: z.string().min(1),
      })
    )
    .min(1)
    .max(10),
});
