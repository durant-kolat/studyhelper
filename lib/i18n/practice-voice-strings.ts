// Textes de la conversation vocale de Pratique (fr + en ; autres langues : anglais, comme planner-strings).
import type { LangCode } from "./languages";

const fr = {
  "start": "Démarrer la conversation vocale",
  "end": "Terminer la conversation",
  "micOn": "Micro activé",
  "micOff": "Micro coupé",
  "soundOn": "Son activé",
  "soundOff": "Son coupé",
  "listening": "Je t'écoute… parle maintenant.",
  "thinking": "Le professeur réfléchit…",
  "speaking": "Le professeur répond à voix haute…",
  "paused": "Micro en pause. Active le micro pour continuer.",
  "heard": "Tu as dit :",
  "noSpeech": "Je n'ai rien entendu. Réessaie ou écris ta question.",
  "unsupported": "La reconnaissance vocale n'est pas disponible dans ce navigateur. Écris ta question à la place (Chrome, Edge ou Safari récents recommandés).",
  "noOutput": "La lecture vocale n'est pas disponible ici : les réponses s'affichent seulement à l'écran.",
  "emptyReply": "Le professeur n'a pas renvoyé de réponse. Pose ta question à nouveau.",
  "mode": "Mode : ta voix est transcrite, envoyée au professeur IA, puis la réponse est lue à voix haute. Ce n'est pas du temps réel : il y a un court délai entre ta question et la réponse.",
} as const;
export type PracticeVoiceKey = keyof typeof fr;
const en: Record<PracticeVoiceKey, string> = {
  "start": "Start voice conversation",
  "end": "End conversation",
  "micOn": "Microphone on",
  "micOff": "Microphone off",
  "soundOn": "Sound on",
  "soundOff": "Sound off",
  "listening": "Listening… speak now.",
  "thinking": "The teacher is thinking…",
  "speaking": "The teacher is speaking…",
  "paused": "Microphone paused. Turn it on to continue.",
  "heard": "You said:",
  "noSpeech": "I heard nothing. Try again or type your question.",
  "unsupported": "Voice recognition is not available in this browser. Type your question instead (recent Chrome, Edge or Safari recommended).",
  "noOutput": "Spoken replies are not available here: answers are shown on screen only.",
  "emptyReply": "The teacher sent no answer. Ask again.",
  "mode": "How it works: your speech is transcribed, sent to the AI teacher, then the answer is read aloud. This is not real time: there is a short delay between your question and the answer.",
};
const S: Partial<Record<LangCode, Record<PracticeVoiceKey, string>>> = { fr, en };

export function practiceVoiceText(lang: LangCode, key: PracticeVoiceKey): string {
  return S[lang]?.[key] ?? en[key] ?? fr[key] ?? key;
}
