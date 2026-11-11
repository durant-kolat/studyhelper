// Langues de l'application — module PUR (serveur + navigateur), aucune dépendance.

export const LANGUAGES = [
  { code: "fr", label: "Français", speech: "fr-FR", dir: "ltr", aiName: "français", englishName: "French (Français)" },
  { code: "en", label: "English", speech: "en-US", dir: "ltr", aiName: "English", englishName: "English" },
  { code: "de", label: "Deutsch", speech: "de-DE", dir: "ltr", aiName: "Deutsch", englishName: "German (Deutsch)" },
  { code: "es", label: "Español", speech: "es-ES", dir: "ltr", aiName: "español", englishName: "Spanish (Español)" },
  { code: "it", label: "Italiano", speech: "it-IT", dir: "ltr", aiName: "italiano", englishName: "Italian (Italiano)" },
  { code: "pt", label: "Português", speech: "pt-PT", dir: "ltr", aiName: "português", englishName: "Portuguese (Português)" },
  { code: "ar", label: "العربية", speech: "ar-SA", dir: "rtl", aiName: "العربية (Arabic)", englishName: "Arabic (العربية)" },
  { code: "zh", label: "中文", speech: "zh-CN", dir: "ltr", aiName: "中文 (Simplified Chinese)", englishName: "Simplified Chinese (中文)" },
  { code: "nl", label: "Nederlands", speech: "nl-NL", dir: "ltr", aiName: "Nederlands", englishName: "Dutch (Nederlands)" },
  { code: "ru", label: "Русский", speech: "ru-RU", dir: "ltr", aiName: "русский", englishName: "Russian (Русский)" },
  { code: "tr", label: "Türkçe", speech: "tr-TR", dir: "ltr", aiName: "Türkçe", englishName: "Turkish (Türkçe)" },
  { code: "ja", label: "日本語", speech: "ja-JP", dir: "ltr", aiName: "日本語", englishName: "Japanese (日本語)" },
  { code: "ko", label: "한국어", speech: "ko-KR", dir: "ltr", aiName: "한국어", englishName: "Korean (한국어)" },
  { code: "hi", label: "हिन्दी", speech: "hi-IN", dir: "ltr", aiName: "हिन्दी", englishName: "Hindi (हिन्दी)" },
  // Langues ajoutées : interface traduite automatiquement à la première utilisation (voir /api/translate-ui).
  // beta = langues peu dotées : l'IA les comprend et les écrit, mais avec moins de précision.
  { code: "pl", label: "Polski", speech: "pl-PL", dir: "ltr", aiName: "polski", englishName: "Polish (Polski)" },
  { code: "uk", label: "Українська", speech: "uk-UA", dir: "ltr", aiName: "українська", englishName: "Ukrainian (Українська)" },
  { code: "ro", label: "Română", speech: "ro-RO", dir: "ltr", aiName: "română", englishName: "Romanian (Română)" },
  { code: "el", label: "Ελληνικά", speech: "el-GR", dir: "ltr", aiName: "Ελληνικά", englishName: "Greek (Ελληνικά)" },
  { code: "cs", label: "Čeština", speech: "cs-CZ", dir: "ltr", aiName: "čeština", englishName: "Czech (Čeština)" },
  { code: "sv", label: "Svenska", speech: "sv-SE", dir: "ltr", aiName: "svenska", englishName: "Swedish (Svenska)" },
  { code: "da", label: "Dansk", speech: "da-DK", dir: "ltr", aiName: "dansk", englishName: "Danish (Dansk)" },
  { code: "fi", label: "Suomi", speech: "fi-FI", dir: "ltr", aiName: "suomi", englishName: "Finnish (Suomi)" },
  { code: "no", label: "Norsk", speech: "nb-NO", dir: "ltr", aiName: "norsk", englishName: "Norwegian (Norsk)" },
  { code: "hu", label: "Magyar", speech: "hu-HU", dir: "ltr", aiName: "magyar", englishName: "Hungarian (Magyar)" },
  { code: "bg", label: "Български", speech: "bg-BG", dir: "ltr", aiName: "български", englishName: "Bulgarian (Български)" },
  { code: "hr", label: "Hrvatski", speech: "hr-HR", dir: "ltr", aiName: "hrvatski", englishName: "Croatian (Hrvatski)" },
  { code: "sk", label: "Slovenčina", speech: "sk-SK", dir: "ltr", aiName: "slovenčina", englishName: "Slovak (Slovenčina)" },
  { code: "id", label: "Bahasa Indonesia", speech: "id-ID", dir: "ltr", aiName: "Bahasa Indonesia", englishName: "Indonesian (Bahasa Indonesia)" },
  { code: "ms", label: "Bahasa Melayu", speech: "ms-MY", dir: "ltr", aiName: "Bahasa Melayu", englishName: "Malay (Bahasa Melayu)" },
  { code: "vi", label: "Tiếng Việt", speech: "vi-VN", dir: "ltr", aiName: "Tiếng Việt", englishName: "Vietnamese (Tiếng Việt)" },
  { code: "th", label: "ไทย", speech: "th-TH", dir: "ltr", aiName: "ไทย", englishName: "Thai (ไทย)" },
  { code: "fil", label: "Filipino", speech: "fil-PH", dir: "ltr", aiName: "Filipino", englishName: "Filipino (Tagalog)" },
  { code: "bn", label: "বাংলা", speech: "bn-BD", dir: "ltr", aiName: "বাংলা", englishName: "Bengali (বাংলা)" },
  { code: "ur", label: "اردو", speech: "ur-PK", dir: "rtl", aiName: "اردو", englishName: "Urdu (اردو)" },
  { code: "fa", label: "فارسی", speech: "fa-IR", dir: "rtl", aiName: "فارسی", englishName: "Persian (فارسی)" },
  { code: "ta", label: "தமிழ்", speech: "ta-IN", dir: "ltr", aiName: "தமிழ்", englishName: "Tamil (தமிழ்)" },
  { code: "te", label: "తెలుగు", speech: "te-IN", dir: "ltr", aiName: "తెలుగు", englishName: "Telugu (తెలుగు)" },
  { code: "mr", label: "मराठी", speech: "mr-IN", dir: "ltr", aiName: "मराठी", englishName: "Marathi (मराठी)" },
  { code: "he", label: "עברית", speech: "he-IL", dir: "rtl", aiName: "עברית", englishName: "Hebrew (עברית)" },
  { code: "ne", label: "नेपाली", speech: "ne-NP", dir: "ltr", aiName: "नेपाली", englishName: "Nepali (नेपाली)" },
  { code: "sw", label: "Kiswahili", speech: "sw-KE", dir: "ltr", aiName: "Kiswahili", englishName: "Swahili (Kiswahili)" },
  { code: "af", label: "Afrikaans", speech: "af-ZA", dir: "ltr", aiName: "Afrikaans", englishName: "Afrikaans" },
  { code: "am", label: "አማርኛ", speech: "am-ET", dir: "ltr", aiName: "አማርኛ", englishName: "Amharic (አማርኛ)" },
  { code: "zu", label: "isiZulu", speech: "zu-ZA", dir: "ltr", aiName: "isiZulu", englishName: "Zulu (isiZulu)", beta: true },
  { code: "ha", label: "Hausa", speech: "ha-NG", dir: "ltr", aiName: "Hausa", englishName: "Hausa", beta: true },
  { code: "yo", label: "Yorùbá", speech: "yo-NG", dir: "ltr", aiName: "Yorùbá", englishName: "Yoruba (Yorùbá)", beta: true },
  { code: "ig", label: "Igbo", speech: "ig-NG", dir: "ltr", aiName: "Igbo", englishName: "Igbo", beta: true },
  { code: "so", label: "Soomaali", speech: "so-SO", dir: "ltr", aiName: "Soomaali", englishName: "Somali (Soomaali)", beta: true },
  { code: "rw", label: "Kinyarwanda", speech: "rw-RW", dir: "ltr", aiName: "Kinyarwanda", englishName: "Kinyarwanda", beta: true },
  { code: "mg", label: "Malagasy", speech: "mg-MG", dir: "ltr", aiName: "Malagasy", englishName: "Malagasy", beta: true },
  { code: "sn", label: "chiShona", speech: "sn-ZW", dir: "ltr", aiName: "chiShona", englishName: "Shona (chiShona)", beta: true },
  { code: "ln", label: "Lingála", speech: "ln-CD", dir: "ltr", aiName: "Lingála", englishName: "Lingala (Lingála)", beta: true },
  { code: "wo", label: "Wolof", speech: "wo-SN", dir: "ltr", aiName: "Wolof", englishName: "Wolof", beta: true },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: LangCode = "fr";

/** Langues dont l'interface est écrite à la main (lib/i18n/dictionaries). Les autres sont traduites automatiquement. */
export const HANDWRITTEN_UI_CODES = ["fr", "en", "de", "es", "it", "pt", "ar", "zh", "nl", "ru", "tr", "ja", "ko", "hi"] as const;
export function hasHandwrittenUi(code: LangCode): boolean {
  return (HANDWRITTEN_UI_CODES as readonly string[]).includes(code);
}
export function isBetaLanguage(code: LangCode): boolean {
  return "beta" in languageInfo(code);
}

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

/** Valeur inconnue / absente → français (langue d'origine de l'application). */
export function normalizeLanguage(value: unknown): LangCode {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLangCode(base) ? base : DEFAULT_LANGUAGE;
}

export function languageInfo(code: LangCode) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** Code BCP-47 pour la synthèse vocale (ex. « en-US »). */
export function speechLocale(code: LangCode): string {
  return languageInfo(code).speech;
}

/**
 * Directive de langue envoyée à CHAQUE requête IA (Gemini n°1 et Gemini n°2) — jamais laissée au choix du modèle.
 * `lang` = langue actuellement sélectionnée dans l'application : l'unique source de vérité de la langue de sortie.
 */
export function targetLanguageDirective(code: LangCode): string {
  const name = languageInfo(code).englishName;
  return [
    `TARGET LANGUAGE: ${name}`,
    "",
    "RULE:",
    "Always respond in the language currently selected in the application. The selected application language has priority over the language of the user's question, course, document, image or input.",
    "Understand the user's input regardless of its original language, but generate the final response in the user's selected application language.",
    "",
    `Details: every sentence you write for the user — answers, summaries, explanations, questions, exercises, corrections, hints, feedback, titles, labels, captions and any text inside diagrams — must be in ${name}, even if the question, the course, the document or the image is in another language (or if earlier messages were in another language). Never choose the output language yourself and never fall back to French or English on your own. Keep the original course content untouched: do not rewrite or replace it, and if you must quote it, keep the quote in its original language and explain it in ${name}. When the output must be JSON, keep the JSON keys and any fixed code/enum values required by the format EXACTLY as specified, and write only the human-readable text values in ${name}.`,
  ].join("\n");
}

const SYSTEM_PROMPTS: Partial<Record<LangCode, string>> = {
  fr: "Tu es l'assistant Study Helper.\nRéponds exclusivement en français.\nLa langue de l'utilisateur est définie par l'application.\nIgnore la langue du système, du navigateur et du clavier, ainsi que la langue de la question, du cours et de l'historique de conversation.",
  en: "You are the Study Helper assistant.\nRespond exclusively in English.\nThe user's language is defined by the application.\nIgnore the system, browser and keyboard language, as well as the language of the question, the course and the conversation history.",
  de: "Du bist der Study Helper Assistent.\nAntworte ausschließlich auf Deutsch.\nDie Sprache des Benutzers wird von der Anwendung festgelegt.\nIgnoriere die Sprache des Systems, Browsers und der Tastatur sowie die Sprache der Frage, des Kurses und des bisherigen Gesprächs.",
  es: "Eres el asistente de Study Helper.\nResponde exclusivamente en español.\nEl idioma del usuario lo define la aplicación.\nIgnora el idioma del sistema, del navegador y del teclado, así como el idioma de la pregunta, del curso y del historial de la conversación.",
  it: "Sei l'assistente di Study Helper.\nRispondi esclusivamente in italiano.\nLa lingua dell'utente è definita dall'applicazione.\nIgnora la lingua del sistema, del browser e della tastiera, nonché la lingua della domanda, del corso e della cronologia della conversazione.",
  pt: "És o assistente do Study Helper.\nResponde exclusivamente em português.\nO idioma do utilizador é definido pela aplicação.\nIgnora o idioma do sistema, do navegador e do teclado, bem como o idioma da pergunta, do curso e do histórico da conversa.",
  ar: "أنت مساعد Study Helper.\nأجب حصريًا باللغة العربية.\nلغة المستخدم يحددها التطبيق.\nتجاهل لغة النظام والمتصفح ولوحة المفاتيح، وكذلك لغة السؤال والدرس وسجل المحادثة.",
  zh: "你是 Study Helper 助手。\n必须始终使用中文回答。\n用户的语言由应用程序设置决定。\n忽略系统、浏览器和键盘的语言，也忽略问题、课程和对话历史所使用的语言。",
  nl: "Je bent de Study Helper-assistent.\nAntwoord uitsluitend in het Nederlands.\nDe taal van de gebruiker wordt bepaald door de applicatie.\nNegeer de taal van het systeem, de browser en het toetsenbord, evenals de taal van de vraag, de cursus en de gespreksgeschiedenis.",
  ru: "Вы — ассистент Study Helper.\nОтвечайте исключительно на русском языке.\nЯзык пользователя определяется приложением.\nИгнорируйте язык системы, браузера и клавиатуры, а также язык вопроса, курса и истории переписки.",
  tr: "Sen Study Helper asistanısın.\nYalnızca Türkçe yanıt ver.\nKullanıcının dili uygulama tarafından belirlenir.\nSistemin, tarayıcının ve klavyenin dilini, ayrıca sorunun, dersin ve sohbet geçmişinin dilini yok say.",
  ja: "あなたはStudy Helperのアシスタントです。\n必ず日本語のみで回答してください。\nユーザーの言語はアプリケーションによって設定されます。\nシステム、ブラウザ、キーボードの言語、また質問・講座・会話履歴の言語は無視してください。",
  ko: "당신은 Study Helper 어시스턴트입니다.\n반드시 한국어로만 답변하세요.\n사용자의 언어는 애플리케이션에서 설정됩니다.\n시스템, 브라우저, 키보드의 언어는 물론 질문, 강좌, 대화 기록의 언어도 무시하세요.",
  hi: "आप Study Helper सहायक हैं।\nकेवल हिन्दी में उत्तर दें।\nउपयोगकर्ता की भाषा एप्लिकेशन द्वारा निर्धारित होती है।\nसिस्टम, ब्राउज़र और कीबोर्ड की भाषा, साथ ही प्रश्न, पाठ्यक्रम और बातचीत के इतिहास की भाषा को नज़रअंदाज़ करें।",
};

/**
 * Prompt système dynamique, écrit DANS la langue cible : placé tout en haut des instructions
 * (priorité maximale). La langue vient exclusivement de l'application (preferredLanguage) :
 * jamais du système, du navigateur, du clavier ni de la langue détectée dans la question.
 */
export function languageSystemPrompt(code: LangCode): string {
  const written = SYSTEM_PROMPTS[code];
  if (written) return written;
  // Langues ajoutées : consigne générique, écrite en anglais, qui nomme la langue cible (même règles que les autres).
  const name = languageInfo(code).englishName;
  return `You are the Study Helper assistant.\nRespond exclusively in ${name}.\nThe user's language is defined by the application.\nIgnore the system, browser and keyboard language, as well as the language of the question, the course and the conversation history.`;
}

/** Ancien nom, conservé pour compatibilité. */
export const languageInstruction = targetLanguageDirective;

/** Rappel court, ajouté à la FIN de chaque message utilisateur envoyé à l'IA (les modèles obéissent surtout au dernier message). */
export function languageReminder(code: LangCode): string {
  const name = languageInfo(code).englishName;
  return `[TARGET LANGUAGE: ${name} — write your entire final response in ${name}, whatever the language of the input.]`;
}
