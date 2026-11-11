// Ce fichier centralise les appels vers le backend et l'IA.
// Toutes les fonctions ci-dessous interrogent réellement Supabase / l'API
// IA — plus rien n'est simulé. Chaque appel aux routes /api/* joint le
// jeton de session courant : c'est ce jeton, vérifié côté serveur, qui
// détermine l'utilisateur — jamais un id passé dans le corps de la requête.

import { getStoredLanguage, languageHeader } from "@/lib/i18n/client";
import { supabase } from "./supabase";
import type { Difficulty, Evaluation } from "./adaptive";
import type { AssistantMode } from "./assistant-prompt";
import type { Term } from "./premium";
import { methodRequiresPhone, type PaymentMethodId } from "./payment-methods";
import type { OpenAnswerInput, OpenQuestionClient } from "./exam-open";
import type { PaymentView, PremiumOverview, StartPaymentResult, VerifyResult } from "./billing/types";

async function authHeader(): Promise<HeadersInit> {
  // preferredLanguage envoyée à chaque requête : l'IA répond dans la langue choisie, pas dans celle du cours.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...languageHeader(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchSubjectProgress(userId: string) {
  const { data, error } = await supabase
    .from("exam_results")
    .select("subject, score_percent")
    .eq("owner_id", userId);

  if (error || !data) return [];

  const bySubject = new Map<string, number[]>();
  for (const row of data) {
    const list = bySubject.get(row.subject) ?? [];
    list.push(row.score_percent);
    bySubject.set(row.subject, list);
  }

  return Array.from(bySubject.entries()).map(([subject, scores]) => ({
    subject,
    percent: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));
}

export type CourseAnalysis = {
  summary: string;
  key_points: string[];
  questions: { question: string; answer: string }[];
};

export async function analyzeDocument(
  courseId: string
): Promise<CourseAnalysis> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ courseId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "L'analyse a échoué.");
  }
  return data;
}

export type TranslateCourseResult = { text: string; lang: string; cached: boolean; truncated?: boolean };

/** Traduit le texte original d'un document dans la langue actuellement choisie dans l'application (mis en cache côté serveur). */
export async function translateCourse(courseId: string): Promise<TranslateCourseResult> {
  const res = await fetch("/api/translate-course", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ courseId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "La traduction a échoué.");
  }
  return data;
}

// Ce que le client reçoit AVANT de répondre — jamais correctIndex/method,
// qui restent en base côté serveur jusqu'à la correction.
export type ExamQuestion = {
  question: string;
  options: string[];
};

/** Question relue APRÈS correction (table exam_results) : avec la bonne réponse et la méthode. */
export type GradedExamQuestion = ExamQuestion & { correctIndex: number; method: string };

export type StudyLevel =
  | "primaire"
  | "college"
  | "lycee"
  | "universite"
  | "formation_pro";

export type ExamOptions = {
  chapter?: string;
  level?: StudyLevel;
  difficulty?: Difficulty;
  questionCount?: number;
  durationMinutes?: number;
  /** Génère l'examen à partir de ce cours (de la bibliothèque de l'élève). */
  courseId?: string;
  /** Nombre de questions de la Partie B (rédigées / à schéma). 0 = QCM seulement. */
  openCount?: number;
};

export async function generateRealExam(
  subject: string,
  options: ExamOptions = {}
): Promise<{
  examId: string;
  subject: string;
  durationMinutes: number;
  questions: ExamQuestion[];
  /** Partie B : énoncés seulement (ni corrigé ni barème). */
  openQuestions?: OpenQuestionClient[];
}> {
  const chapter = options.chapter?.trim();
  const res = await fetch("/api/generate-exam", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({
      subject,
      ...options,
      chapter: chapter ? chapter : undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La génération a échoué.");
  return data;
}

export async function submitExam(
  examId: string,
  answers: number[],
  openAnswers?: OpenAnswerInput[]
): Promise<{ resultId: string; scorePercent: number; openQuestions?: number }> {
  const res = await fetch("/api/exams/submit", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ examId, answers, ...(openAnswers && openAnswers.length > 0 ? { openAnswers } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La correction a échoué.");
  return data;
}

export type QuizQuestion = ExamQuestion & { subject: string };

export async function generateWeeklyQuiz(questionCount?: number): Promise<{
  examId: string;
  questions: QuizQuestion[];
  weakSubjects: string[];
}> {
  const res = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(questionCount ? { questionCount } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La génération a échoué.");
  return data;
}

export type QuizSubjectScore = { subject: string; correct: number; total: number };

export async function submitQuiz(
  examId: string,
  answers: number[]
): Promise<{
  globalPercent: number;
  totalCorrect: number;
  totalQuestions: number;
  bySubject: QuizSubjectScore[];
  weakSubjects: string[];
}> {
  const res = await fetch("/api/quizzes/submit", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ examId, answers }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La correction a échoué.");
  return data;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Compteur du jour, tel que calculé par le SERVEUR (jamais par le navigateur). */
export type AssistantUsage = {
  isPremium: boolean;
  limit: number;
  used: number;
  remaining: number;
};

/**
 * Erreur typée de l'assistant. `code` permet à l'interface de réagir
 * correctement — en particulier de NE proposer Premium que pour
 * `quota_exceeded` (limite réellement atteinte), jamais pour une panne.
 */
export class AssistantError extends Error {
  code: string;
  status: number;
  usage?: AssistantUsage;

  constructor(message: string, code: string, status: number, usage?: AssistantUsage) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
    this.status = status;
    this.usage = usage;
  }
}

export type AssistantRequest = {
  message?: string;
  history: ChatMessage[];
  mode?: AssistantMode;
  difficulty?: Difficulty;
  subject?: string;
  chapter?: string;
  courseId?: string;
  count?: number;
  /** Langue sélectionnée dans l'application : renseignée automatiquement par askAssistant. */
  language?: string;
};

export type AssistantReply = {
  reply: string;
  evaluation: Evaluation | null;
  usage: AssistantUsage | null;
};

const ASSISTANT_TIMEOUT_MS = 60_000;

export async function askAssistant(
  request: AssistantRequest
): Promise<AssistantReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({
        ...request,
        language: getStoredLanguage() ?? undefined, // langue de l'application, jamais celle du navigateur
        // Le serveur ne garde que les derniers tours : inutile d'envoyer plus.
        history: request.history.slice(-12),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AssistantError(
      "Connexion impossible. Vérifie ta connexion internet puis réessaie — ta question n'a pas été comptée.",
      "network",
      0
    );
  } finally {
    clearTimeout(timer);
  }

  // Une réponse non-JSON (page d'erreur d'hébergeur, délai dépassé…) est
  // une panne technique, pas une limite atteinte.
  let data: {
    error?: string;
    code?: string;
    reply?: string;
    evaluation?: Evaluation | null;
    usage?: AssistantUsage | null;
  } | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data || typeof data.reply !== "string") {
    throw new AssistantError(
      data?.error ?? "L'assistant est momentanément indisponible. Réessaie dans un instant.",
      // Seul le serveur de Study Helper peut dire « limite atteinte » (code explicite).
      // Un 429 sans ce code (hébergeur, réseau…) est une panne, pas un quota.
      data?.code ?? (res.status === 401 ? "unauthenticated" : "server_error"),
      res.status,
      data?.usage ?? undefined
    );
  }

  return {
    reply: data.reply,
    evaluation: data.evaluation ?? null,
    usage: data.usage ?? null,
  };
}

/** Lit le compteur du jour sans rien consommer. null = indisponible. */
export async function fetchAssistantUsage(): Promise<AssistantUsage | null> {
  try {
    const res = await fetch("/api/assistant", {
      method: "GET",
      headers: await authHeader(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.usage as AssistantUsage | null) ?? null;
  } catch {
    return null;
  }
}

export type CVEntry = { period: string; title: string; detail: string };
export type CVData = {
  fullName: string;
  targetRole: string;
  email?: string;
  phone?: string;
  location?: string;
  tagline: string;
  education: CVEntry[];
  experience: CVEntry[];
  skills: string[];
};

export async function generateCV(fields: {
  fullName: string;
  targetRole: string;
  email?: string;
  phone?: string;
  location?: string;
  education?: string;
  experience?: string;
  skills?: string;
}): Promise<CVData> {
  const res = await fetch("/api/career-cv", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La génération du CV a échoué.");
  return data.cv;
}

export async function generateCoverLetter(fields: {
  fullName: string;
  targetRole: string;
  company?: string;
  strengths?: string;
}): Promise<string> {
  const res = await fetch("/api/career-letter", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "La génération de la lettre a échoué.");
  return data.letter;
}

export async function askInterviewer(
  targetRole: string,
  message: string,
  history: ChatMessage[]
): Promise<string> {
  const res = await fetch("/api/career-interview", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ targetRole, message, history }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "La simulation a échoué.");
  return data.reply;
}

export type OrientationPath = {
  title: string;
  why: string;
  next_steps: string;
};

export async function getOrientation(fields: {
  favoriteSubjects: string;
  interests?: string;
  skills?: string;
  constraints?: string;
}): Promise<OrientationPath[]> {
  const res = await fetch("/api/career-orientation", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "L'orientation a échoué.");
  return data.paths;
}

// ---------------------------------------------------------------------------
// Paiements (Premium, cours de répétition) — MTN MoMo et Orange Money (API officielles
// des opérateurs), Visa / Mastercard et PayPal (page du prestataire). Le montant et la durée sont TOUJOURS fixés
// côté serveur ; le navigateur ne peut ni les modifier ni « déclarer » un paiement réussi.
// ---------------------------------------------------------------------------

export type StartPaymentRequest =
  | { type: "premium"; plan: Term; method: PaymentMethodId; phone?: string; /** ISO 3166-1 (défaut : CM) */ country?: string }
  | { type: "tutoring"; offerId: string; method: PaymentMethodId; phone?: string; country?: string };

export class PaymentError extends Error {
  code: string | null;
  /** Référence d'un paiement déjà en cours (code « payment_pending »), pour le reprendre. */
  ref: string | null;
  /** Code HTTP de la réponse du serveur (null si la requête n'a pas abouti). */
  status: number | null;
  constructor(message: string, code: string | null = null, ref: string | null = null, status: number | null = null) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.ref = ref;
    this.status = status;
  }
}

async function paymentFetch(path: string, body?: unknown, method: "GET" | "POST" = "POST"): Promise<{ res: Response; data: any }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: await authHeader(),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new PaymentError("Connexion impossible. Vérifie ta connexion internet puis réessaie.", "network");
  }
  const data = await res.json().catch(() => null);
  return { res, data };
}

/**
 * Crée la transaction côté serveur puis lance le paiement chez le prestataire.
 * NE valide rien : Premium n'est activé que lorsque le serveur a vérifié le paiement
 * auprès du prestataire. Renvoie la référence et, selon le moyen choisi :
 *   flow « redirect » → paymentUrl (page officielle Orange Money / page sécurisée de la carte)
 *   flow « push »     → pas d'URL : le client confirme sur son téléphone (MTN MoMo)
 */
export async function startPayment(request: StartPaymentRequest): Promise<StartPaymentResult> {
  // Le numéro n'est envoyé que pour les moyens qui le demandent (MTN MoMo).
  const body = { ...request, phone: methodRequiresPhone(request.method) ? request.phone?.trim() : undefined };
  const { res, data } = await paymentFetch("/api/payments/initiate", body);
  if (!res.ok || !data?.ref) {
    throw new PaymentError(data?.error ?? "Impossible de lancer le paiement.", data?.code ?? null, data?.ref ?? null, res.status);
  }
  return data as StartPaymentResult;
}

/** Demande au SERVEUR de vérifier le paiement auprès du prestataire (et d'activer s'il est confirmé). */
export async function verifyPayment(ref: string): Promise<VerifyResult & { temporary?: boolean }> {
  const { res, data } = await paymentFetch("/api/payments/verify", { ref });
  if (!res.ok || !data?.payment) throw new PaymentError(data?.error ?? "Vérification impossible.", data?.code ?? null, null, res.status);
  return data as VerifyResult & { temporary?: boolean };
}

/** Annule un paiement EN ATTENTE (jamais un paiement déjà confirmé). */
export async function cancelPayment(ref: string): Promise<PaymentView> {
  const { res, data } = await paymentFetch("/api/payments/cancel", { ref });
  if (!res.ok || !data?.payment) throw new PaymentError(data?.error ?? "Annulation impossible.", data?.code ?? null, null, res.status);
  return data.payment as PaymentView;
}

/** Statut Premium, offres (prix/durée fixés par le serveur) et historique des paiements. */
export async function fetchPremiumOverview(): Promise<PremiumOverview> {
  const { res, data } = await paymentFetch("/api/premium/status", undefined, "GET");
  if (!res.ok || !data?.subscription) throw new PaymentError(data?.error ?? "Impossible de charger ton abonnement.", data?.code ?? null, null, res.status);
  return data as PremiumOverview;
}

/** Désactive le renouvellement automatique (l'activer n'est possible que si un prestataire le supporte). */
export async function setAutoRenew(enabled: boolean): Promise<void> {
  const { res, data } = await paymentFetch("/api/premium/auto-renew", { enabled });
  if (!res.ok) throw new PaymentError(data?.error ?? "Modification impossible.", data?.code ?? null, null, res.status);
}

// ---------------------------------------------------------------------------
// Groupes d'étude : inclus dans Premium (plus aucun paiement séparé)
// ---------------------------------------------------------------------------

/**
 * Rejoint un groupe. La règle « Premium actif requis » est appliquée par la base
 * (fonction SQL join_group) : le navigateur ne peut pas la contourner.
 */
export async function joinGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("join_group", { p_group_id: groupId });
  if (!error) return;
  if (error.message.includes("premium_required")) {
    throw new Error("Les groupes d'étude sont réservés aux abonnés Premium.");
  }
  if (/function .*join_group|schema cache/i.test(error.message)) {
    throw new Error("Les groupes ne sont pas encore activés (migration V1.9 à exécuter).");
  }
  throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Photo de profil
// ---------------------------------------------------------------------------

async function bearerOnly(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Envoie la photo (déjà réduite) ; renvoie l'URL enregistrée dans profiles.avatar_url. */
export async function uploadAvatar(image: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", image, "avatar.jpg");
  let res: Response;
  try {
    // Pas de Content-Type : le navigateur ajoute lui-même la frontière multipart.
    res = await fetch("/api/profile/avatar", { method: "POST", headers: await bearerOnly(), body: form });
  } catch {
    throw new Error("Connexion impossible. Vérifie ta connexion internet puis réessaie.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.avatarUrl !== "string") {
    throw new Error(data?.error ?? "L'envoi de la photo a échoué. Réessaie.");
  }
  return data.avatarUrl as string;
}

/** Retire la photo de profil (retour à l'image par défaut). */
export async function removeAvatar(): Promise<void> {
  const res = await fetch("/api/profile/avatar", { method: "DELETE", headers: await bearerOnly() });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Impossible de retirer la photo.");
  }
}

// ---------------------------------------------------------------------------
// Correction d'examen (v2.9) : analyse pédagogique IA + chat contextuel par question
// ---------------------------------------------------------------------------
export type ExamAnalysisItem = {
  index: number;
  errorExplanation: string;
  steps: string[];
  example: string;
  similarExercise: { statement: string; answer: string } | null;
  uncertainty: string | null;
};
export type QuestionChatMessage = { role: "user" | "assistant"; content: string };
export type QuestionChatAction = "understand" | "rephrase" | "steps" | "example" | "similar";

/** Lance (ou relance) l'analyse IA. Idempotent : une analyse déjà faite est renvoyée sans nouveau débit, sauf regenerate. */
export async function analyzeExam(resultId: string, regenerate = false): Promise<{ analysis: ExamAnalysisItem[]; cached?: boolean; noMistakes?: boolean }> {
  const res = await fetch("/api/exams/analyze", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ resultId, regenerate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "L'analyse IA a échoué.");
  return data;
}

export async function askQuestionChat(
  resultId: string,
  questionIndex: number,
  input: { action: QuestionChatAction } | { message: string },
  part: "A" | "B" = "A",
): Promise<{ reply: string; messages: QuestionChatMessage[] }> {
  const res = await fetch("/api/exams/question-chat", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ resultId, questionIndex, part, ...input }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Le tuteur IA a échoué.");
  return data;
}

// ---------------------------------------------------------------------------
// Partie B des examens : correction IA des questions rédigées / à schéma
// ---------------------------------------------------------------------------
export type OpenAnswerRow = {
  id: string;
  question_index: number;
  kind: "text" | "diagram";
  question: string;
  expected_answer: string | null;
  max_points: number;
  answer_text: string | null;
  image_paths: string[];
  status: "pending" | "grading" | "graded" | "failed";
  points: number | null;
  feedback: { criteria?: { criterion: string; awarded: number; max: number; comment: string }[]; summary?: string; uncertainty?: string | null } | null;
};

/** Lance la correction IA de la Partie B. Idempotent : les réponses déjà corrigées ne sont ni recorrigées ni débitées de nouveau. */
export async function gradeOpenAnswers(resultId: string): Promise<{ items: OpenAnswerRow[]; warning?: string; inProgress?: boolean }> {
  const res = await fetch("/api/exams/grade-open", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ resultId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "La correction de la Partie B a échoué.");
  return data;
}

/** Historique des paiements de l'utilisateur connecté (50 derniers). */
export async function fetchPaymentHistory(): Promise<import("./billing/types").PaymentView[]> {
  const res = await fetch("/api/payments/history", { headers: await authHeader(), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Historique indisponible.");
  return data.payments ?? [];
}
