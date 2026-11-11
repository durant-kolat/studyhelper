// Textes des emplacements publicitaires. Langues écrites à la main ; les autres : anglais (comme greeting-strings).
import type { LangCode } from "./languages";

export type AdStringKey =
  | "label" | "houseLabel" | "loading" | "consentText" | "accept" | "refuse" | "choices" | "close" | "see"
  | "houseTitle1" | "houseBody1" | "houseTitle2" | "houseBody2" | "placeholder";

type Dict = Record<AdStringKey, string>;

const S: Partial<Record<LangCode, Dict>> = {
  fr: {
    label: "Publicité", houseLabel: "Study Helper", loading: "Chargement de la publicité…",
    consentText: "Des publicités peuvent utiliser les cookies de ton navigateur. Les autoriser ?",
    accept: "Accepter", refuse: "Refuser", choices: "Mes choix pub", close: "Fermer", see: "Voir",
    houseTitle1: "Passe à Premium", houseBody1: "Sans publicité, et {premium} questions/jour à l'assistant IA au lieu de {free}.",
    houseTitle2: "Encore des matières faibles ?", houseBody2: "Premium débloque plus d'examens et de Grands Quiz générés par jour.",
    placeholder: "Emplacement publicitaire (aperçu développement)",
  },
  en: {
    label: "Advertisement", houseLabel: "Study Helper", loading: "Loading advertisement…",
    consentText: "Ads may use cookies from your browser. Allow them?",
    accept: "Accept", refuse: "Decline", choices: "Ad choices", close: "Close", see: "View",
    houseTitle1: "Go Premium", houseBody1: "No ads, and {premium} AI assistant questions/day instead of {free}.",
    houseTitle2: "Still weak in some subjects?", houseBody2: "Premium unlocks more exams and Big Quizzes generated per day.",
    placeholder: "Ad placeholder (development preview)",
  },
  es: {
    label: "Publicidad", houseLabel: "Study Helper", loading: "Cargando publicidad…",
    consentText: "Los anuncios pueden usar cookies de tu navegador. ¿Permitirlas?",
    accept: "Aceptar", refuse: "Rechazar", choices: "Mis opciones", close: "Cerrar", see: "Ver",
    houseTitle1: "Pásate a Premium", houseBody1: "Sin publicidad y {premium} preguntas/día al asistente IA en lugar de {free}.",
    houseTitle2: "¿Aún flojo en alguna materia?", houseBody2: "Premium desbloquea más exámenes y Grandes Quiz generados al día.",
    placeholder: "Espacio publicitario (vista de desarrollo)",
  },
  pt: {
    label: "Publicidade", houseLabel: "Study Helper", loading: "A carregar publicidade…",
    consentText: "Os anúncios podem usar cookies do teu navegador. Permitir?",
    accept: "Aceitar", refuse: "Recusar", choices: "Minhas escolhas", close: "Fechar", see: "Ver",
    houseTitle1: "Passa para Premium", houseBody1: "Sem publicidade e {premium} perguntas/dia ao assistente IA em vez de {free}.",
    houseTitle2: "Ainda fraco em alguma matéria?", houseBody2: "O Premium desbloqueia mais exames e Grandes Quizzes gerados por dia.",
    placeholder: "Espaço publicitário (pré-visualização de desenvolvimento)",
  },
  de: {
    label: "Werbung", houseLabel: "Study Helper", loading: "Werbung wird geladen…",
    consentText: "Werbung kann Cookies deines Browsers verwenden. Erlauben?",
    accept: "Akzeptieren", refuse: "Ablehnen", choices: "Werbe-Auswahl", close: "Schließen", see: "Ansehen",
    houseTitle1: "Werde Premium", houseBody1: "Ohne Werbung und {premium} KI-Fragen/Tag statt {free}.",
    houseTitle2: "Noch schwach in manchen Fächern?", houseBody2: "Premium schaltet mehr Prüfungen und Große Quiz pro Tag frei.",
    placeholder: "Werbeplatz (Entwicklungsvorschau)",
  },
  it: {
    label: "Pubblicità", houseLabel: "Study Helper", loading: "Caricamento pubblicità…",
    consentText: "Gli annunci possono usare i cookie del tuo browser. Consentirli?",
    accept: "Accetta", refuse: "Rifiuta", choices: "Le mie scelte", close: "Chiudi", see: "Vedi",
    houseTitle1: "Passa a Premium", houseBody1: "Senza pubblicità e {premium} domande/giorno all'assistente IA invece di {free}.",
    houseTitle2: "Ancora debole in qualche materia?", houseBody2: "Premium sblocca più esami e Grandi Quiz generati al giorno.",
    placeholder: "Spazio pubblicitario (anteprima di sviluppo)",
  },
  ar: {
    label: "إعلان", houseLabel: "Study Helper", loading: "جارٍ تحميل الإعلان…",
    consentText: "قد تستخدم الإعلانات ملفات تعريف الارتباط في متصفحك. هل تسمح بها؟",
    accept: "موافق", refuse: "رفض", choices: "خيارات الإعلانات", close: "إغلاق", see: "عرض",
    houseTitle1: "انتقل إلى Premium", houseBody1: "بدون إعلانات، و{premium} سؤالاً يوميًا للمساعد الذكي بدلاً من {free}.",
    houseTitle2: "هل ما زلت ضعيفًا في بعض المواد؟", houseBody2: "يفتح Premium المزيد من الامتحانات والاختبارات الكبرى يوميًا.",
    placeholder: "مساحة إعلانية (معاينة التطوير)",
  },
};

export function adText(lang: LangCode, key: AdStringKey, vars?: Record<string, string | number>): string {
  let s = (S[lang] ?? S.en!)[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
