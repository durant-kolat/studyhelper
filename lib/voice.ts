import { splitForSpeech, toSpeakableText } from "./speech-text";
import { DEFAULT_LANGUAGE, speechLocale, type LangCode } from "./i18n/languages";

// Entrée et sortie vocales pour l'assistant.
//
// SORTIE (lecture à voix haute) : synthèse vocale native du navigateur (speechSynthesis) — inchangée.
//
// ENTRÉE (micro), deux moteurs, un seul point d'entrée (`startListening`) :
//   1. reconnaissance NATIVE (Web Speech API) — gratuite, sans clé. ATTENTION : dans Chrome/Edge, elle
//      n'est pas locale : le navigateur envoie l'audio aux serveurs de reconnaissance de Google. Quand ce
//      service est injoignable (Brave, Chromium sans clés Google, VPN/pare-feu/réseau qui le bloque, hors
//      ligne, navigateurs intégrés), le navigateur renvoie l'erreur « network » même si Internet fonctionne :
//      c'est la cause de « Network issue during voice recognition ». Ce n'est pas corrigeable côté code
//      client en insistant sur le moteur natif ;
//   2. transcription par le SERVEUR (/api/transcribe) — on enregistre le micro (MediaRecorder) et Gemini
//      (même modèle, même clé GEMINI_API_KEY) transcrit. Utilisée automatiquement quand le moteur natif
//      échoue (« network », service refusé, langue non prise en charge) ou n'existe pas (Firefox, Safari
//      anciens…). Le choix est mémorisé pour la session afin de ne pas retenter le moteur natif à chaque fois.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** MediaRecorder + getUserMedia disponibles (contexte sécurisé HTTPS/localhost requis par les navigateurs). */
export function isRecorderSupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (window.isSecureContext === false) return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

/** Vrai si AU MOINS un moteur d'entrée vocale est utilisable (natif ou enregistrement + transcription serveur). */
export function isVoiceInputSupported() {
  return getRecognitionCtor() !== null || isRecorderSupported();
}

export function isVoiceOutputSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Démarre l'écoute du micro. Appelle onResult(texte) une fois la phrase reconnue, ou
 * onError(code) en cas de souci. `code` est un VoiceErrorCode stable (jamais un texte déjà
 * traduit) : c'est à l'appelant (composant React, via useI18n/t()) de l'afficher dans la
 * langue de l'application — voir `voiceErrorKey()` ci-dessous pour la clé de dictionnaire
 * correspondante. Renvoie une fonction pour arrêter l'écoute manuellement.
 */
export type VoiceErrorCode =
  | "unsupported" // navigateur sans Web Speech API (ex. Firefox desktop, la plupart des navigateurs hors Chromium/Safari)
  | "denied" // permission micro refusée par l'utilisateur ou par la politique du navigateur
  | "no-speech" // micro ouvert mais rien capté dans le délai imparti
  | "no-mic" // aucun micro détecté / déjà utilisé par une autre application
  | "network" // la reconnaissance (traitée côté navigateur, parfois via un service distant) a échoué réseau
  | "lang-unsupported" // ce navigateur n'a pas de modèle de reconnaissance pour cette langue
  | "unavailable"; // erreur non identifiée

/** @deprecated conservé pour compatibilité ; préférer le code "unsupported" + traduction côté UI. */
export const MIC_UNAVAILABLE_MESSAGE = "Micro non disponible";

/** Clé de dictionnaire (voir lib/i18n/dictionaries) correspondant à un VoiceErrorCode, à afficher via t(). */
export const VOICE_ERROR_DICT_KEY: Record<VoiceErrorCode, "voice.error.unsupported" | "voice.error.denied" | "voice.error.noSpeech" | "voice.error.noMic" | "voice.error.network" | "voice.error.langUnsupported" | "voice.error.unavailable"> = {
  unsupported: "voice.error.unsupported",
  denied: "voice.error.denied",
  "no-speech": "voice.error.noSpeech",
  "no-mic": "voice.error.noMic",
  network: "voice.error.network",
  "lang-unsupported": "voice.error.langUnsupported",
  unavailable: "voice.error.unavailable",
};

function mapRecognitionErrorCode(code: string | undefined): VoiceErrorCode | null {
  switch (code) {
    case "not-allowed":
    case "permission-denied":
      return "denied";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "no-mic";
    case "network":
      return "network";
    case "language-not-supported":
      return "lang-unsupported";
    case "service-not-allowed":
      return "denied";
    case "aborted":
      return null; // arrêt volontaire (bouton, changement de page…) : pas une erreur à afficher
    default:
      return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Entrée vocale : UNE session d'écoute à la fois (démarrer en arrête proprement la précédente).
// `onResult` est appelé au plus une fois, puis `onEnd` exactement une fois (résultat, erreur ou arrêt).
// ---------------------------------------------------------------------------

type ListenSession = { stop: () => void; abort: () => void };
let activeListen: ListenSession | null = null;

const SERVER_STT_KEY = "studyhelper.sttServer";
function preferServerStt(): boolean {
  try {
    return window.sessionStorage.getItem(SERVER_STT_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberServerStt() {
  try {
    window.sessionStorage.setItem(SERVER_STT_KEY, "1");
  } catch {
    /* stockage indisponible : on retentera simplement le moteur natif la prochaine fois */
  }
}

/** Arrête l'écoute en cours ; ce qui a déjà été entendu est tout de même traité (résultat envoyé à `onResult`). */
export function stopListening() {
  activeListen?.stop();
}

/** Interrompt l'écoute en cours SANS rien livrer (changement de page, sortie du mode conversation…). */
export function abortListening() {
  activeListen?.abort();
}

export function isListening() {
  return activeListen !== null;
}

// Paramètres de la détection de fin de phrase du moteur d'enregistrement.
const REC_MAX_MS = 30_000; // durée maximale d'une question
const REC_NO_SPEECH_MS = 8_000; // rien dit au bout de 8 s → fin
const REC_SILENCE_MS = 1_600; // silence après la parole → fin de la phrase
const REC_MIN_MS = 500; // en dessous : bruit de clic, pas une question

function pickRecorderMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  try {
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  } catch {
    return "";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("lecture de l'enregistrement impossible"));
    reader.readAsDataURL(blob);
  });
}

/** Envoie l'enregistrement à /api/transcribe (Gemini, même clé/modèle). Renvoie le texte, "" (rien compris) ou un code d'erreur. */
async function transcribeOnServer(
  blob: Blob,
  lang: LangCode,
  signal: AbortSignal
): Promise<{ text: string } | { error: VoiceErrorCode }> {
  try {
    const [audio, { supabase }, { languageHeader }] = await Promise.all([
      blobToBase64(blob),
      import("./supabase"),
      import("./i18n/client"),
    ]);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ audio, mimeType: blob.type || "audio/webm", language: lang }),
      signal,
    });
    if (!res.ok) {
      console.error(`[voice] transcription serveur : HTTP ${res.status}`);
      return { error: "unavailable" };
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  } catch (err) {
    if (signal.aborted) return { text: "" };
    console.error("[voice] transcription serveur injoignable :", err);
    return { error: "network" };
  }
}

export function startListening(
  onResult: (text: string) => void,
  onError: (code: VoiceErrorCode) => void,
  onEnd: () => void,
  lang: LangCode = DEFAULT_LANGUAGE
): () => void {
  // Une seule session : évite les conflits (InvalidStateError, deux micros, deux résultats).
  abortListening();

  let finished = false;
  let aborted = false;
  let delivered = false;
  const abortController = new AbortController();
  let engineStop: () => void = () => {};
  let engineAbort: () => void = () => {};

  const session: ListenSession = {
    stop: () => engineStop(),
    abort: () => {
      aborted = true;
      abortController.abort();
      engineAbort();
      finish();
    },
  };

  function finish() {
    if (finished) return;
    finished = true;
    if (activeListen === session) activeListen = null;
    onEnd();
  }
  function deliver(text: string) {
    if (aborted || finished || delivered) return;
    delivered = true;
    onResult(text);
  }
  function fail(code: VoiceErrorCode) {
    if (aborted || finished) return;
    onError(code);
  }

  activeListen = session;

  // ---- Moteur 2 : enregistrement + transcription serveur --------------------------------------
  function startRecorder() {
    if (!isRecorderSupported()) {
      fail("unsupported");
      finish();
      return;
    }
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let audioCtx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let manualStop = false;
    let speechSeen = false;
    const chunks: Blob[] = [];
    const startedAt = Date.now();

    const cleanup = () => {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* déjà arrêté */
      }
      stream = null;
      try {
        void audioCtx?.close();
      } catch {
        /* déjà fermé */
      }
      audioCtx = null;
    };

    engineStop = () => {
      manualStop = true;
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* déjà arrêté */
      }
    };
    engineAbort = () => {
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* déjà arrêté */
      }
      cleanup();
    };

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        stream = s;
        if (aborted) {
          cleanup();
          return;
        }
        const mime = pickRecorderMime();
        recorder = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => {
          console.error("[voice] erreur MediaRecorder");
          cleanup();
          fail("unavailable");
          finish();
        };
        recorder.onstop = () => {
          const duration = Date.now() - startedAt;
          const type = recorder?.mimeType || mime || "audio/webm";
          cleanup();
          if (aborted || finished) return;
          // Pas de parole détectée (et l'utilisateur n'a pas forcé l'envoi) → aucun appel API inutile.
          if (chunks.length === 0 || duration < REC_MIN_MS || (!speechSeen && !manualStop)) {
            fail("no-speech");
            finish();
            return;
          }
          void transcribeOnServer(new Blob(chunks, { type }), lang, abortController.signal).then((out) => {
            if (aborted || finished) return;
            if ("error" in out) fail(out.error);
            else if (out.text) deliver(out.text);
            else fail("no-speech");
            finish();
          });
        };

        // Détection de fin de phrase (volume) — le bruit de fond est mesuré pendant les 400 premières ms.
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            audioCtx = new Ctx();
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            audioCtx.createMediaStreamSource(s).connect(analyser);
            const buf = new Uint8Array(analyser.fftSize);
            let noiseFloor = 0;
            let noiseSamples = 0;
            let lastVoice = 0;
            timer = setInterval(() => {
              const now = Date.now();
              analyser.getByteTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) {
                const v = (buf[i] - 128) / 128;
                sum += v * v;
              }
              const rms = Math.sqrt(sum / buf.length);
              if (now - startedAt < 400) {
                noiseFloor = (noiseFloor * noiseSamples + rms) / (noiseSamples + 1);
                noiseSamples++;
                return;
              }
              const threshold = Math.max(0.012, noiseFloor * 2.5);
              if (rms > threshold) {
                speechSeen = true;
                lastVoice = now;
              }
              const silentFor = now - (lastVoice || startedAt);
              if (
                (speechSeen && silentFor > REC_SILENCE_MS) ||
                (!speechSeen && now - startedAt > REC_NO_SPEECH_MS) ||
                now - startedAt > REC_MAX_MS
              ) {
                engineStop();
              }
            }, 100);
          }
        } catch (err) {
          console.warn("[voice] détection de silence indisponible (arrêt manuel / durée maximale) :", err);
        }
        // Sans analyse du volume : on enregistre jusqu'à l'arrêt manuel ou la durée maximale, et on envoie.
        if (!timer) {
          speechSeen = true;
          timer = setInterval(() => {
            if (Date.now() - startedAt > REC_MAX_MS) engineStop();
          }, 500);
        }
        recorder.start(250);
      })
      .catch((err: unknown) => {
        cleanup();
        const name = err instanceof DOMException ? err.name : "";
        console.error(`[voice] accès micro impossible (${name || "erreur inconnue"}) :`, err);
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") fail("denied");
        else if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" || name === "AbortError") fail("no-mic");
        else fail("unavailable");
        finish();
      });
  }

  // ---- Moteur 1 : reconnaissance native du navigateur -----------------------------------------
  const Ctor = getRecognitionCtor();
  if (!Ctor || preferServerStt()) {
    startRecorder();
    return () => session.stop();
  }

  let recognition: SpeechRecognitionLike;
  let nativeFailed = false; // une erreur native a déjà été traitée (elle est signalée une seule fois)
  let handedOver = false; // le moteur d'enregistrement a pris le relais : c'est lui qui terminera la session
  let gotNativeResult = false;
  try {
    recognition = new Ctor();
    recognition.lang = speechLocale(lang);
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      try {
        const text = String(event.results?.[0]?.[0]?.transcript ?? "").trim();
        if (text) {
          gotNativeResult = true;
          deliver(text);
        }
      } catch (err) {
        console.error("[voice] résultat de reconnaissance illisible :", err);
        nativeFailed = true;
        fail("unavailable");
      }
    };
    recognition.onerror = (event) => {
      const raw: string | undefined = event?.error;
      if (aborted || nativeFailed) return;
      // Le service de reconnaissance du navigateur est injoignable / refusé / sans modèle pour cette langue :
      // on bascule AUTOMATIQUEMENT sur l'enregistrement + transcription serveur plutôt que d'afficher une erreur.
      if ((raw === "network" || raw === "service-not-allowed" || raw === "language-not-supported") && isRecorderSupported()) {
        nativeFailed = true;
        console.warn(`[voice] reconnaissance native indisponible (${raw}) → transcription serveur.`);
        if (raw !== "language-not-supported") rememberServerStt();
        handedOver = true;
        engineStop = () => {};
        engineAbort = () => {};
        startRecorder();
        return;
      }
      const mapped = mapRecognitionErrorCode(raw);
      // « aborted » (arrêt volontaire) : rien à afficher, et le « end » qui suit ne doit pas devenir un faux « no-speech ».
      nativeFailed = true;
      if (mapped) {
        console.error(`[voice] échec de reconnaissance vocale (code navigateur : "${raw}") → ${mapped}`);
        fail(mapped);
      }
    };
    recognition.onend = () => {
      if (aborted || handedOver) return; // arrêt volontaire, ou l'autre moteur termine la session
      // Fin sans résultat ni erreur (le navigateur a coupé le micro) : c'est un « rien entendu », pas un succès.
      if (!nativeFailed && !gotNativeResult && !delivered) fail("no-speech");
      finish();
    };

    engineStop = () => {
      try {
        recognition.stop();
      } catch {
        /* déjà arrêté */
      }
    };
    engineAbort = () => {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        (recognition as unknown as { abort?: () => void }).abort?.();
      } catch {
        /* déjà arrêté */
      }
    };

    recognition.start();
  } catch (err) {
    console.error("[voice] impossible de démarrer la reconnaissance native :", err);
    if (isRecorderSupported()) {
      nativeFailed = true;
      handedOver = true;
      engineStop = () => {};
      engineAbort = () => {};
      startRecorder();
    } else {
      fail("unavailable");
      finish();
    }
  }

  return () => session.stop();
}

// ---------------------------------------------------------------------------
// Réglages audio persistés (vitesse de lecture + voix choisie) — un seul
// réglage par appareil, appliqué à toute lecture quelle que soit la page.
// Stockage local uniquement (aucune donnée serveur, aucun compte requis).
// ---------------------------------------------------------------------------

export type AudioPrefs = { rate: number; voiceURI: string | null };
const AUDIO_PREFS_KEY = "studyhelper.audioPrefs";
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
const DEFAULT_PREFS: AudioPrefs = { rate: 1, voiceURI: null };

export function getAudioPrefs(): AudioPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    const rate = typeof parsed.rate === "number" && Number.isFinite(parsed.rate) ? Math.min(MAX_RATE, Math.max(MIN_RATE, parsed.rate)) : DEFAULT_PREFS.rate;
    const voiceURI = typeof parsed.voiceURI === "string" ? parsed.voiceURI : null;
    return { rate, voiceURI };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setAudioPrefs(prefs: Partial<AudioPrefs>) {
  if (typeof window === "undefined") return;
  try {
    const current = getAudioPrefs();
    const next: AudioPrefs = {
      rate: prefs.rate !== undefined ? Math.min(MAX_RATE, Math.max(MIN_RATE, prefs.rate)) : current.rate,
      voiceURI: prefs.voiceURI !== undefined ? prefs.voiceURI : current.voiceURI,
    };
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible (navigation privée, quota…) : réglage ignoré, la lecture garde ses valeurs par défaut */
  }
}

/** Voix disponibles pour une langue (celles dont le code commence par la base, ex. « fr » pour « fr-FR »), triées par nom. */
export function listVoicesForLang(lang: LangCode): SpeechSynthesisVoice[] {
  if (!isVoiceOutputSupported()) return [];
  try {
    const voices = window.speechSynthesis.getVoices();
    const base = speechLocale(lang).toLowerCase().split("-")[0];
    return voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base)).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Meilleure voix disponible pour un code de langue : la voix choisie par l'utilisateur si elle existe
 * toujours et correspond à la langue, sinon « fr-FR » d'abord, puis « fr-* » ; null → la langue de l'énoncé suffit. */
function pickVoice(locale: string): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    const exact = locale.toLowerCase();
    const base = exact.split("-")[0];
    const preferredURI = getAudioPrefs().voiceURI;
    if (preferredURI) {
      const preferred = voices.find((v) => v.voiceURI === preferredURI);
      if (preferred && preferred.lang.toLowerCase().replace("_", "-").startsWith(base)) return preferred;
    }
    return (
      voices.find((v) => v.lang.toLowerCase().replace("_", "-") === exact) ??
      voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base)) ??
      null
    );
  } catch {
    return null;
  }
}

/** Vrai/faux si l'appareil a une voix pour cette langue ; null tant que la liste des voix n'est pas chargée. */
export function voiceAvailable(lang: LangCode): boolean | null {
  if (!isVoiceOutputSupported()) return false;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;
    const base = speechLocale(lang).toLowerCase().split("-")[0];
    return voices.some((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lecture : UNE session à la fois, morceau par morceau.
//  - la langue de la voix est TOUJOURS celle choisie par l'utilisateur (preferredLanguage) : l'IA répond
//    dans cette langue, la voix suit donc le texte réellement affiché ;
//  - pause / reprise sont gérées par nous (arrêt du morceau en cours puis relecture de ce morceau) :
//    speechSynthesis.pause() est ignoré ou défaillant sur plusieurs navigateurs (Android, Safari).
// ---------------------------------------------------------------------------

type Session = { chunks: string[]; index: number; locale: string; paused: boolean; finished: boolean; onEnd?: () => void };
let session: Session | null = null;

function endSession(s: Session) {
  if (s.finished) return;
  s.finished = true;
  if (session === s) session = null;
  s.onEnd?.();
}

function speakCurrentChunk(s: Session) {
  if (session !== s || s.paused || s.finished) return;
  const utterance = new SpeechSynthesisUtterance(s.chunks[s.index]);
  utterance.lang = s.locale;
  utterance.rate = getAudioPrefs().rate;
  const voice = pickVoice(s.locale);
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    if (session !== s || s.paused) return;
    s.index += 1;
    if (s.index >= s.chunks.length) endSession(s);
    else speakCurrentChunk(s);
  };
  utterance.onerror = () => {
    // Annulation volontaire (pause / arrêt / nouvelle lecture) : géré ailleurs, rien à faire ici.
    if (session !== s || s.paused) return;
    endSession(s);
  };
  window.speechSynthesis.speak(utterance);
}

/**
 * Lit un texte à voix haute dans la langue donnée (preferredLanguage). Renvoie une fonction d'arrêt.
 * Le texte est d'abord converti en langage parlé (« √2 » → « racine carrée de 2 », puissances, symboles ;
 * blocs de code non épelés). `onEnd` est appelé UNE seule fois : fin normale, erreur ou arrêt.
 */
export function speak(text: string, onEnd?: () => void, lang: LangCode = DEFAULT_LANGUAGE): () => void {
  if (!isVoiceOutputSupported()) {
    onEnd?.();
    return () => {};
  }

  // Une seule lecture à la fois : l'ancienne session se termine proprement (son onEnd est appelé).
  if (session) endSession(session);
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume(); // sort d'un éventuel état « en pause » hérité (Chrome)

  const chunks = splitForSpeech(toSpeakableText(text, lang));
  if (chunks.length === 0) {
    onEnd?.();
    return () => {};
  }

  const s: Session = { chunks, index: 0, locale: speechLocale(lang), paused: false, finished: false, onEnd };
  session = s;
  speakCurrentChunk(s);

  return () => {
    if (session === s) {
      session = null;
      window.speechSynthesis.cancel();
    }
    endSession(s);
  };
}

export function pauseSpeaking() {
  if (!session || session.paused || !isVoiceOutputSupported()) return;
  session.paused = true;
  window.speechSynthesis.cancel(); // arrête le morceau en cours ; il sera relu à la reprise
}

export function resumeSpeaking() {
  if (!session || !session.paused || !isVoiceOutputSupported()) return;
  session.paused = false;
  window.speechSynthesis.resume();
  speakCurrentChunk(session);
}

export function stopSpeaking() {
  if (!isVoiceOutputSupported()) return;
  const s = session;
  session = null;
  window.speechSynthesis.cancel();
  if (s) endSession(s);
}
