import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { hasGeminiKey, transcribeAudio } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { recordAiCost } from "@/lib/ai-cost";

export const runtime = "nodejs";
export const maxDuration = 45;

// Transcription vocale de secours : utilisée quand la reconnaissance native du navigateur est
// indisponible (erreur « network » de Chrome/Edge, Brave, Firefox, navigateurs intégrés…).
// Même clé GEMINI_API_KEY, même modèle que le reste de l'application. Ne consomme PAS le quota
// « questions IA » : seule la question envoyée ensuite à l'assistant est comptée.

const MAX_BASE64_CHARS = 4_000_000; // ≈ 3 Mo d'audio : très au-delà de 30 s de parole compressée
const ALLOWED_MIME = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|flac)(;.*)?$/i;

export async function POST(req: NextRequest) {
  if (!hasGeminiKey()) {
    console.error("[transcribe] GEMINI_API_KEY absente côté serveur.");
    return NextResponse.json({ error: "Service non configuré.", code: "not_configured" }, { status: 500 });
  }

  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié.", code: "unauthenticated" }, { status: 401 });

  // Protection contre les appels inutiles / abus : 20 transcriptions par minute et par utilisateur.
  const limit = hitRateLimit(`transcribe:${ownerId}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Trop de requêtes vocales. Réessaie dans un instant.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let body: { audio?: unknown; mimeType?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide.", code: "bad_request" }, { status: 400 });
  }

  const audio = typeof body.audio === "string" ? body.audio : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";
  if (!audio || !/^[A-Za-z0-9+/=]+$/.test(audio)) {
    return NextResponse.json({ error: "Audio manquant ou invalide.", code: "bad_request" }, { status: 400 });
  }
  if (audio.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: "Enregistrement trop long.", code: "too_large" }, { status: 413 });
  }
  if (!ALLOWED_MIME.test(mimeType)) {
    return NextResponse.json({ error: "Format audio non pris en charge.", code: "bad_request" }, { status: 400 });
  }

  const lang = await resolveLanguage(req, ownerId, body.language);
  // Gemini attend le type MIME sans paramètre de codec (« audio/webm;codecs=opus » → « audio/webm »).
  const result = await transcribeAudio(audio, mimeType.split(";")[0].toLowerCase(), lang);
  // Mesure seule (aucun blocage, comportement inchangé) : rend visible le coût réel de la transcription.
  void recordAiCost(ownerId, "transcribe", result.ok ? result.usage : undefined, result.ok ? "ok" : "error");
  if (!result.ok) {
    console.error("[transcribe] échec :", result.detail);
    return NextResponse.json({ error: "La transcription a échoué.", code: "transcription_failed" }, { status: 502 });
  }
  return NextResponse.json({ text: result.text });
}
