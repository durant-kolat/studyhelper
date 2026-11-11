// Prépare un texte pour la lecture vocale (synthèse vocale du navigateur).
// Module PUR (aucune dépendance) : testable hors navigateur.
//
// Pourquoi : les moteurs de synthèse lisent mal — ou ignorent — les symboles
// mathématiques (« √2 » devient parfois juste « 2 ») et prononcent le markdown.
// On convertit donc le texte en français parlé : « racine carrée de 2 »,
// « x au carré », etc. Les blocs de code ne sont pas épelés.

import type { LangCode } from "./i18n/languages";

type Spoken = {
  cbrt: string; fourthRoot: string; sqrt: string; squared: string; cubed: string; power: string;
  plusMinus: string; times: string; divided: string; lte: string; gte: string; neq: string; approx: string;
  implies: string; arrow: string; infinity: string; celsius: string; degrees: string; percent: string;
  over: string; minus: string; plus: string; equals: string; code: string;
};

// Mots lus à voix haute pour les symboles mathématiques, dans chaque langue de l'application.
const SPOKEN: Partial<Record<LangCode, Spoken>> & { fr: Spoken; en: Spoken } = {
  fr: { cbrt: "racine cubique de", fourthRoot: "racine quatrième de", sqrt: "racine carrée de", squared: "au carré", cubed: "au cube", power: "puissance", plusMinus: "plus ou moins", times: "fois", divided: "divisé par", lte: "inférieur ou égal à", gte: "supérieur ou égal à", neq: "différent de", approx: "environ égal à", implies: "implique", arrow: "donne", infinity: "l'infini", celsius: "degrés Celsius", degrees: "degrés", percent: "pour cent", over: "sur", minus: "moins", plus: "plus", equals: "égale", code: "Un exemple de code est affiché à l'écran." },
  en: { cbrt: "cube root of", fourthRoot: "fourth root of", sqrt: "square root of", squared: "squared", cubed: "cubed", power: "to the power", plusMinus: "plus or minus", times: "times", divided: "divided by", lte: "less than or equal to", gte: "greater than or equal to", neq: "not equal to", approx: "approximately equal to", implies: "implies", arrow: "gives", infinity: "infinity", celsius: "degrees Celsius", degrees: "degrees", percent: "percent", over: "over", minus: "minus", plus: "plus", equals: "equals", code: "A code example is shown on screen." },
  de: { cbrt: "dritte Wurzel aus", fourthRoot: "vierte Wurzel aus", sqrt: "Quadratwurzel aus", squared: "zum Quadrat", cubed: "hoch drei", power: "hoch", plusMinus: "plus oder minus", times: "mal", divided: "geteilt durch", lte: "kleiner oder gleich", gte: "größer oder gleich", neq: "ungleich", approx: "ungefähr gleich", implies: "impliziert", arrow: "ergibt", infinity: "unendlich", celsius: "Grad Celsius", degrees: "Grad", percent: "Prozent", over: "durch", minus: "minus", plus: "plus", equals: "gleich", code: "Ein Codebeispiel wird auf dem Bildschirm angezeigt." },
  es: { cbrt: "raíz cúbica de", fourthRoot: "raíz cuarta de", sqrt: "raíz cuadrada de", squared: "al cuadrado", cubed: "al cubo", power: "elevado a", plusMinus: "más o menos", times: "por", divided: "dividido entre", lte: "menor o igual que", gte: "mayor o igual que", neq: "distinto de", approx: "aproximadamente igual a", implies: "implica", arrow: "da", infinity: "infinito", celsius: "grados Celsius", degrees: "grados", percent: "por ciento", over: "sobre", minus: "menos", plus: "más", equals: "igual a", code: "Se muestra un ejemplo de código en pantalla." },
  it: { cbrt: "radice cubica di", fourthRoot: "radice quarta di", sqrt: "radice quadrata di", squared: "al quadrato", cubed: "al cubo", power: "elevato a", plusMinus: "più o meno", times: "per", divided: "diviso", lte: "minore o uguale a", gte: "maggiore o uguale a", neq: "diverso da", approx: "circa uguale a", implies: "implica", arrow: "dà", infinity: "infinito", celsius: "gradi Celsius", degrees: "gradi", percent: "percento", over: "su", minus: "meno", plus: "più", equals: "uguale a", code: "Un esempio di codice è mostrato sullo schermo." },
  pt: { cbrt: "raiz cúbica de", fourthRoot: "raiz quarta de", sqrt: "raiz quadrada de", squared: "ao quadrado", cubed: "ao cubo", power: "elevado a", plusMinus: "mais ou menos", times: "vezes", divided: "dividido por", lte: "menor ou igual a", gte: "maior ou igual a", neq: "diferente de", approx: "aproximadamente igual a", implies: "implica", arrow: "dá", infinity: "infinito", celsius: "graus Celsius", degrees: "graus", percent: "por cento", over: "sobre", minus: "menos", plus: "mais", equals: "igual a", code: "Um exemplo de código é mostrado no ecrã." },
  ar: { cbrt: "الجذر التكعيبي لـ", fourthRoot: "الجذر الرابع لـ", sqrt: "الجذر التربيعي لـ", squared: "تربيع", cubed: "تكعيب", power: "أس", plusMinus: "زائد أو ناقص", times: "ضرب", divided: "مقسومًا على", lte: "أصغر من أو يساوي", gte: "أكبر من أو يساوي", neq: "لا يساوي", approx: "يساوي تقريبًا", implies: "يستلزم", arrow: "يعطي", infinity: "ما لا نهاية", celsius: "درجة مئوية", degrees: "درجة", percent: "بالمئة", over: "على", minus: "ناقص", plus: "زائد", equals: "يساوي", code: "يظهر مثال برمجي على الشاشة." },
  zh: { cbrt: "立方根", fourthRoot: "四次方根", sqrt: "根号", squared: "的平方", cubed: "的立方", power: "的", plusMinus: "加减", times: "乘以", divided: "除以", lte: "小于等于", gte: "大于等于", neq: "不等于", approx: "约等于", implies: "推出", arrow: "得到", infinity: "无穷大", celsius: "摄氏度", degrees: "度", percent: "百分之", over: "分之", minus: "减", plus: "加", equals: "等于", code: "屏幕上显示了一个代码示例。" },
  nl: { cbrt: "derdemachtswortel van", fourthRoot: "vierdemachtswortel van", sqrt: "vierkantswortel van", squared: "in het kwadraat", cubed: "tot de derde macht", power: "tot de macht", plusMinus: "plus of min", times: "maal", divided: "gedeeld door", lte: "kleiner dan of gelijk aan", gte: "groter dan of gelijk aan", neq: "ongelijk aan", approx: "ongeveer gelijk aan", implies: "impliceert", arrow: "geeft", infinity: "oneindig", celsius: "graden Celsius", degrees: "graden", percent: "procent", over: "gedeeld door", minus: "min", plus: "plus", equals: "is gelijk aan", code: "Een codevoorbeeld wordt op het scherm getoond." },
  ru: { cbrt: "кубический корень из", fourthRoot: "корень четвёртой степени из", sqrt: "квадратный корень из", squared: "в квадрате", cubed: "в кубе", power: "в степени", plusMinus: "плюс-минус", times: "умножить на", divided: "делить на", lte: "меньше или равно", gte: "больше или равно", neq: "не равно", approx: "приблизительно равно", implies: "влечёт", arrow: "даёт", infinity: "бесконечность", celsius: "градусов Цельсия", degrees: "градусов", percent: "процентов", over: "делить на", minus: "минус", plus: "плюс", equals: "равно", code: "На экране показан пример кода." },
  tr: { cbrt: "küp kökü", fourthRoot: "dördüncü kuvvetten kökü", sqrt: "karekökü", squared: "karesi", cubed: "küpü", power: "üssü", plusMinus: "artı veya eksi", times: "çarpı", divided: "bölü", lte: "küçük veya eşit", gte: "büyük veya eşit", neq: "eşit değil", approx: "yaklaşık eşit", implies: "gerektirir", arrow: "verir", infinity: "sonsuz", celsius: "santigrat derece", degrees: "derece", percent: "yüzde", over: "bölü", minus: "eksi", plus: "artı", equals: "eşittir", code: "Ekranda bir kod örneği gösteriliyor." },
  ja: { cbrt: "の立方根", fourthRoot: "の四乗根", sqrt: "の平方根", squared: "の二乗", cubed: "の三乗", power: "の何乗か", plusMinus: "プラスマイナス", times: "かける", divided: "割る", lte: "以下", gte: "以上", neq: "等しくない", approx: "ほぼ等しい", implies: "ならば", arrow: "すると", infinity: "無限大", celsius: "摂氏", degrees: "度", percent: "パーセント", over: "分の", minus: "マイナス", plus: "プラス", equals: "イコール", code: "画面にコード例が表示されています。" },
  ko: { cbrt: "세제곱근", fourthRoot: "네제곱근", sqrt: "제곱근", squared: "제곱", cubed: "세제곱", power: "거듭제곱", plusMinus: "플러스 마이너스", times: "곱하기", divided: "나누기", lte: "이하", gte: "이상", neq: "같지 않음", approx: "약", implies: "그러면", arrow: "결과는", infinity: "무한대", celsius: "섭씨", degrees: "도", percent: "퍼센트", over: "분의", minus: "마이너스", plus: "플러스", equals: "는", code: "화면에 코드 예시가 표시됩니다." },
  hi: { cbrt: "का घनमूल", fourthRoot: "का चतुर्थ मूल", sqrt: "का वर्गमूल", squared: "का वर्ग", cubed: "का घन", power: "की घात", plusMinus: "धन या ऋण", times: "गुणा", divided: "भाग", lte: "से कम या बराबर", gte: "से अधिक या बराबर", neq: "असमान", approx: "लगभग बराबर", implies: "अतः", arrow: "परिणाम", infinity: "अनंत", celsius: "डिग्री सेल्सियस", degrees: "डिग्री", percent: "प्रतिशत", over: "बटा", minus: "ऋण", plus: "धन", equals: "बराबर", code: "स्क्रीन पर एक कोड उदाहरण दिखाया गया है।" },
};

const CODE_NOTICE_FOR = (lang: LangCode) => ` ${(SPOKEN[lang] ?? SPOKEN.en).code} `;

export function toSpeakableText(input: string, lang: LangCode = "fr"): string {
  let t = input ?? "";

  // --- Code : jamais épelé (bloc ``` même non refermé) ; le code inline garde son contenu ---
  t = t.replace(/```[\s\S]*?(?:```|$)/g, CODE_NOTICE_FOR(lang));
  t = t.replace(/`([^`\n]*)`/g, "$1");

  // --- Markdown ---
  t = t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // liens [texte](url) → texte
    .replace(/https?:\/\/\S+/g, " lien ") // URL nue
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // titres
    .replace(/^\s*>\s?/gm, "") // citations
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "") // ligne de séparation de tableau
    .replace(/\|/g, ", ") // cellules de tableau
    .replace(/^\s*[-*•]\s+/gm, "") // puces
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s.,;:!?)]|$)/g, "$1$2");

  // --- Mathématiques → langue parlée (celle de l'utilisateur) ---
  const w = SPOKEN[lang] ?? SPOKEN.en;
  t = t
    .replace(/∛/g, ` ${w.cbrt} `)
    .replace(/∜/g, ` ${w.fourthRoot} `)
    .replace(/√/g, ` ${w.sqrt} `)
    .replace(/([A-Za-z0-9)\]])²/g, `$1 ${w.squared}`)
    .replace(/([A-Za-z0-9)\]])³/g, `$1 ${w.cubed}`)
    .replace(/([A-Za-z0-9)\]])\^2\b/g, `$1 ${w.squared}`)
    .replace(/([A-Za-z0-9)\]])\^3\b/g, `$1 ${w.cubed}`)
    .replace(/([A-Za-z0-9)\]])\^(\w+)/g, `$1 ${w.power} $2`)
    .replace(/±/g, ` ${w.plusMinus} `)
    .replace(/×/g, ` ${w.times} `)
    .replace(/÷/g, ` ${w.divided} `)
    .replace(/≤/g, ` ${w.lte} `)
    .replace(/≥/g, ` ${w.gte} `)
    .replace(/≠/g, ` ${w.neq} `)
    .replace(/≈/g, ` ${w.approx} `)
    .replace(/⇒/g, ` ${w.implies} `)
    .replace(/→/g, ` ${w.arrow} `)
    .replace(/π/g, " pi ")
    .replace(/∞/g, ` ${w.infinity} `)
    .replace(/(\d)\s*°\s*C\b/g, `$1 ${w.celsius}`)
    .replace(/(\d)\s*°/g, `$1 ${w.degrees}`)
    .replace(/(\d)\s*%/g, `$1 ${w.percent}`)
    .replace(/\b(\d+|[a-z])\s*\/\s*(\d+|[a-z])\b/g, `$1 ${w.over} $2`) // 1/2 → « 1 sur 2 »
    .replace(/(\s)[-−–](\s)/g, `$1${w.minus}$2`) // « 3 - 2 » ; les traits d'union de mots restent intacts
    .replace(/(\s)\+(\s)/g, `$1${w.plus}$2`)
    .replace(/(\s)=(\s)/g, `$1${w.equals}$2`);

  // --- Émojis et ponctuation de mise en forme ---
  t = t.replace(/\p{Extended_Pictographic}/gu, "");

  // --- Espaces : paragraphes → pause, le reste sur une ligne ---
  t = t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\.\s*\.(\s|$)/g, ".$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return t;
}

/**
 * Découpe en morceaux d'au plus `max` caractères, à la fin des phrases. Les
 * longues synthèses s'arrêtent net après ~15 s dans Chrome : des morceaux courts
 * évitent ce défaut.
 */
export function splitForSpeech(text: string, max = 200): string[] {
  const sentences = text.split(/(?<=[.!?…:;])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = (piece: string) => {
    if (!piece) return;
    if ((current + " " + piece).trim().length <= max) {
      current = (current + " " + piece).trim();
    } else {
      if (current) chunks.push(current);
      current = piece;
    }
  };

  for (const sentence of sentences) {
    if (sentence.length <= max) {
      push(sentence);
      continue;
    }
    // Phrase trop longue : on coupe aux virgules, puis aux espaces.
    for (const part of sentence.split(/(?<=,)\s+/)) {
      if (part.length <= max) {
        push(part);
        continue;
      }
      let rest = part;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut <= 0) cut = max;
        push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      push(rest);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
