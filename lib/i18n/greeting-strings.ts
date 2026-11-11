// Salutations du tableau de bord (14 langues écrites à la main ; les autres langues : anglais).
import type { LangCode } from "./languages";
import type { GreetingPeriod } from "../greeting";

const G: Partial<Record<LangCode, Record<GreetingPeriod, string>>> = {
  fr: { morning: "Bonjour", afternoon: "Bon après-midi", evening: "Bonsoir" },
  en: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
  de: { morning: "Guten Morgen", afternoon: "Guten Tag", evening: "Guten Abend" },
  es: { morning: "Buenos días", afternoon: "Buenas tardes", evening: "Buenas noches" },
  it: { morning: "Buongiorno", afternoon: "Buon pomeriggio", evening: "Buonasera" },
  pt: { morning: "Bom dia", afternoon: "Boa tarde", evening: "Boa noite" },
  ar: { morning: "صباح الخير", afternoon: "مساء الخير", evening: "مساء الخير" },
  zh: { morning: "早上好", afternoon: "下午好", evening: "晚上好" },
  nl: { morning: "Goedemorgen", afternoon: "Goedemiddag", evening: "Goedenavond" },
  ru: { morning: "Доброе утро", afternoon: "Добрый день", evening: "Добрый вечер" },
  tr: { morning: "Günaydın", afternoon: "İyi günler", evening: "İyi akşamlar" },
  ja: { morning: "おはようございます", afternoon: "こんにちは", evening: "こんばんは" },
  ko: { morning: "좋은 아침이에요", afternoon: "좋은 오후예요", evening: "좋은 저녁이에요" },
  hi: { morning: "सुप्रभात", afternoon: "नमस्कार", evening: "शुभ संध्या" },
};

/** « Bonjour, Jean ! » (français : espace avant « ! »). Sans prénom : « Bonjour ! ». */
export function greetingText(lang: LangCode, period: GreetingPeriod, firstName: string | null): string {
  const word = (G[lang] ?? G.en!)[period];
  const bang = lang === "fr" ? " !" : "!";
  return firstName ? `${word}, ${firstName}${bang}` : `${word}${bang}`;
}
