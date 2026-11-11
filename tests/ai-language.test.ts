// Tests de la chaîne IA : langue cible, routage Gemini n°1 / Gemini n°2, cours conservé, voix.
// Exécution : npx tsx tests/ai-language.test.ts
// Le réseau est SIMULÉ (fetch intercepté) : on vérifie exactement ce qui est envoyé à chaque IA.
// Ce que ces tests NE prouvent PAS : la qualité réelle de la langue produite par les modèles (voir README).

process.env.GEMINI_API_KEY = "test-gemini";
process.env.GEMINI_MODEL = "gemini-2.5-flash"; // modèle de Gemini n°1 (inchangé)
delete process.env.GEMINI_PRACTICE_MODEL; // Gemini n°2 : modèle par défaut = gemini-3.5-flash-lite
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

type Call = { url: string; body: any };
let calls: Call[] = [];
let gemini2Fails = false;

(globalThis as any).fetch = async (url: string, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), body });
  if (String(url).includes("openai")) throw new Error("Appel OpenAI interdit : OpenAI a été remplacé par Gemini n°2.");
  if (gemini2Fails && String(url).includes("gemini-3.5-flash-lite")) return new Response("boom", { status: 500 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "GEMINI-REPLY" }] } }] }), { status: 200 });
};

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log("  ✗ ÉCHEC :", name, extra);
  }
}

const LANGS = [
  ["fr", "French (Français)"], ["en", "English"], ["de", "German (Deutsch)"], ["es", "Spanish (Español)"],
  ["it", "Italian (Italiano)"], ["pt", "Portuguese (Português)"], ["ar", "Arabic (العربية)"], ["zh", "Simplified Chinese (中文)"],
] as const;
const RULE_APP = "Always respond in the language currently selected in the application. The selected application language has priority over the language of the user's question, course, document, image or input.";
const RULE = "Understand the user's input regardless of its original language, but generate the final response in the user's selected application language.";

const geminiSystem = (c: Call) => c.body.systemInstruction.parts[0].text as string;
const geminiLastUser = (c: Call) => c.body.contents[c.body.contents.length - 1].parts[0].text as string;
// Gemini n°2 parle le même protocole que Gemini n°1 : seuls le modèle (URL) et le rôle diffèrent.
const gemini2System = geminiSystem;
const gemini2LastUser = geminiLastUser;
const who = (c: Call) => (c.url.includes("gemini-3.5-flash-lite") ? "gemini2" : c.url.includes("gemini-2.5-flash") ? "gemini1" : "autre");

async function main() {
  const { callGemini } = await import("../lib/gemini");
  const { callGemini2 } = await import("../lib/ai/gemini2");
  const { runAi } = await import("../lib/ai/run");
  const { routeAi } = await import("../lib/ai/router");
  const { analyzeImage } = await import("../lib/ai/vision");
  const { resolveLanguage } = await import("../lib/ai/language");

  const FR_COURSE = "La photosynthèse est le processus par lequel les plantes transforment la lumière en énergie.";
  const EN_COURSE = "Photosynthesis is the process by which plants convert light into energy.";

  console.log("1) Directive de langue sur CHAQUE requête Gemini n°1 et Gemini n°2 (8 langues)");
  for (const [code, name] of LANGS) {
    calls = [];
    await callGemini("Résume ce cours.", undefined, false, [], { lang: code });
    await callGemini2("Résume ce cours.", undefined, [], { lang: code });
    const [g, o] = calls;
    check(`${code} : Gemini n°1 → gemini-2.5-flash`, who(g) === "gemini1", g.url);
    check(`${code} : Gemini n°2 → gemini-3.5-flash-lite`, who(o) === "gemini2", o.url);
    check(`Gemini ${code} : règle unique (système)`, geminiSystem(g).includes(RULE_APP));
    check(`Gemini2 ${code} : règle unique (système)`, gemini2System(o).includes(RULE_APP));
    check(`Gemini ${code} : plus de règle « langue de l'utilisateur »`, !geminiSystem(g).includes("Répondre dans la langue utilisée par l'utilisateur") && !geminiSystem(g).includes("Switch language only"));
    check(`Gemini2 ${code} : plus de règle « langue de l'utilisateur »`, !gemini2System(o).includes("Répondre dans la langue utilisée par l'utilisateur") && !gemini2System(o).includes("Switch language only"));
    check(`Gemini ${code} : TARGET LANGUAGE (système)`, geminiSystem(g).includes(`TARGET LANGUAGE: ${name}`));
    check(`Gemini ${code} : RULE (système)`, geminiSystem(g).includes(RULE));
    check(`Gemini ${code} : rappel final`, geminiLastUser(g).includes(`TARGET LANGUAGE: ${name}`));
    check(`Gemini2 ${code} : TARGET LANGUAGE (système)`, gemini2System(o).includes(`TARGET LANGUAGE: ${name}`));
    check(`Gemini2 ${code} : RULE (système)`, gemini2System(o).includes(RULE));
    check(`Gemini2 ${code} : rappel final`, gemini2LastUser(o).includes(`TARGET LANGUAGE: ${name}`));
    // Une seule langue cible par requête : aucune autre langue ne doit être désignée comme cible.
    for (const [c2, n2] of LANGS) if (c2 !== code) check(`Gemini ${code} : pas de cible ${c2}`, !geminiSystem(g).includes(`TARGET LANGUAGE: ${n2}`));
  }

  console.log("2) Cours dans une autre langue : réponse dans la langue choisie, cours conservé");
  const scenarios: [string, string, string][] = [
    ["en", FR_COURSE, "English + cours français"], ["de", FR_COURSE, "Deutsch + cours français"],
    ["es", EN_COURSE, "Español + cours anglais"], ["fr", EN_COURSE, "Français + cours anglais"],
    ["ar", FR_COURSE, "العربية + cours français"], ["zh", FR_COURSE, "中文 + cours français"],
  ];
  for (const [code, course, label] of scenarios) {
    const name = LANGS.find((l) => l[0] === code)![1];
    for (const engine of ["gemini", "gemini2"] as const) {
      calls = [];
      await runAi({ engine, prompt: `Question : explique.\n\nCOURS :\n${course}`, systemInstruction: "Tu es un assistant.", history: [], lang: code as any });
      const c = calls[0];
      check(`${label} [${engine}] : bon moteur`, who(c) === (engine === "gemini" ? "gemini1" : "gemini2"));
      const user = geminiLastUser(c);
      const sys = geminiSystem(c);
      check(`${label} [${engine}] : cible ${name}`, sys.includes(`TARGET LANGUAGE: ${name}`) && user.includes(`TARGET LANGUAGE: ${name}`));
      check(`${label} [${engine}] : cours original inchangé`, user.includes(course));
    }
  }

  console.log("3) Routage : Pratique → Gemini n°2 ; fonctions existantes → Gemini n°1 ; jamais OpenAI");
  const hosts = () => calls.map((c) => who(c));
  for (const mode of ["question", "exercise", "series", "quiz"]) {
    calls = [];
    const d = routeAi({ mode, message: "x" }, true);
    await runAi({ engine: d.engine, prompt: "p", systemInstruction: "s", history: [], lang: "en" });
    check(`mode ${mode} → Gemini n°2 uniquement`, hosts().join() === "gemini2", hosts().join());
  }
  for (const mode of ["revise", "chat"]) {
    calls = [];
    const d = routeAi({ mode, message: "C'est quoi la photosynthèse ?" }, true);
    await runAi({ engine: d.engine, prompt: "p", systemInstruction: "s", history: [], lang: "en" });
    check(`mode ${mode} (explication) → Gemini n°1 uniquement`, hosts().join() === "gemini1", hosts().join());
  }
  {
    calls = [];
    const d = routeAi({ mode: "chat", message: "Explique la gravité puis entraîne-moi" }, true);
    await runAi({ engine: d.engine, prompt: "p", systemInstruction: "s", history: [], lang: "de" });
    check("explique + entraîne → Gemini n°1 puis Gemini n°2", hosts().join() === "gemini1,gemini2", hosts().join());
    check("…les deux reçoivent la langue allemande", geminiSystem(calls[0]).includes("German (Deutsch)") && gemini2System(calls[1]).includes("German (Deutsch)"));
  }
  {
    calls = []; gemini2Fails = true;
    await runAi({ engine: "gemini2", prompt: "p", systemInstruction: "s", history: [], lang: "es" });
    gemini2Fails = false;
    check("Gemini n°2 en panne → repli Gemini n°1 (assistant)", hosts().join() === "gemini2,gemini1", hosts().join());
    check("…et la langue reste espagnole", geminiSystem(calls[1]).includes("Spanish (Español)"));
  }

  console.log("4) Image / document : analyse dans la langue d'origine, résultat dans langue de l'application");
  {
    calls = [];
    await analyzeImage({ question: "Explique ce schéma", image: { mimeType: "image/jpeg", data: "AAAA" }, system: "s", lang: "en" });
    const c = calls[0];
    check("image (explication) → Gemini n°1", who(c) === "gemini1", c.url);
    check("image Gemini : cible English", c.body.systemInstruction.parts[0].text.includes("TARGET LANGUAGE: English") && c.body.contents[0].parts[0].text.includes("TARGET LANGUAGE: English"));
    check("image Gemini : image transmise", !!c.body.contents[0].parts[1].inline_data);
    calls = [];
    await analyzeImage({ question: "Corrige mon exercice", image: { mimeType: "image/jpeg", data: "AAAA" }, system: "s", lang: "zh" });
    check("image (exercice) → Gemini n°2", who(calls[0]) === "gemini2", calls[0].url);
    check("image Gemini n°2 : cible chinois", gemini2System(calls[0]).includes("Simplified Chinese"));
    check("image Gemini n°2 : image transmise (capacité visuelle conservée)", calls[0].body.contents[0].parts.some((p: any) => p.inline_data?.data === "AAAA"));
    check("image Gemini n°2 : rappel de langue final", gemini2LastUser(calls[0]).includes("TARGET LANGUAGE: Simplified Chinese"));
  }

  console.log("5) Langue résolue côté serveur (preferredLanguage = source unique)");
  for (const [code] of LANGS) {
    const req = new Request("http://x", { headers: { "x-app-language": code } });
    check(`en-tête ${code} → ${code}`, (await resolveLanguage(req, "user-1")) === code);
  }
  check("en-tête invalide, profil illisible → français (jamais écrasé si un choix existe)", (await resolveLanguage(new Request("http://x", { headers: { "x-app-language": "xx" } }), "u")) === "fr");

  console.log("6) Aucune consigne « français » codée en dur ne subsiste");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = [...walk("app/api"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));
  const bad = [/Par défaut : français/, /en français pour la candidature/, /résumé du cours en 3 à 5 phrases, en français/, /entretien d'embauche simulé, en français/];
  for (const f of files) { const s = readFileSync(f, "utf-8"); for (const re of bad) check(`${f} : ${re}`, !re.test(s)); }
  for (const f of files.filter((f) => f.startsWith("app/api"))) {
    const s = readFileSync(f, "utf-8");
    for (const m of s.matchAll(/callGemini2?\(([\s\S]*?)\);/g)) check(`${f} : callGemini(2) transmet lang`, /lang/.test(m[1]), m[1].slice(0, 60));
  }
  for (const f of [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f))) {
    const code = readFileSync(f, "utf-8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    check(`${f} : plus aucune référence OpenAI dans le code`, !/openai|OPENAI_|PRACTICE_ENGINE/i.test(code));
  }
  check("règle contradictoire supprimée de STUDY_HELPER_RULES", !/Répondre dans la langue utilisée par l'utilisateur/.test(readFileSync("lib/study-helper-rules.ts", "utf-8")));
  const provider = readFileSync("lib/i18n/I18nProvider.tsx", "utf-8");
  check("I18nProvider : lecture de profil périmée ignorée (choiceVersion)", /choiceVersion\.current !== versionAtStart/.test(provider));
  check("I18nProvider : choix marqué non enregistré AVANT l'écriture du profil", provider.indexOf("markDirty(true);") < provider.indexOf("update({ preferred_language: next })"));

  console.log("7) Voix : langue choisie, Lire / Pause / Reprendre / Arrêter");
  const spoken: { text: string; lang: string; fire: (k: "end" | "error") => void }[] = [];
  let cancels = 0;
  (globalThis as any).window = {
    speechSynthesis: {
      speak(u: any) { spoken.push({ text: u.text, lang: u.lang, fire: (k) => (k === "end" ? u.onend?.() : u.onerror?.({})) }); },
      cancel() { cancels++; const last = spoken[spoken.length - 1]; if (last) (last as any).cancelled = true; },
      resume() {}, pause() {}, getVoices: () => [],
    },
  };
  (globalThis as any).SpeechSynthesisUtterance = class { text: string; lang = ""; voice: any = null; onend: any; onerror: any; constructor(t: string) { this.text = t; } };
  const voice = await import("../lib/voice");
  const long = "First sentence of the answer. " .repeat(30) + "Last one.";
  for (const [code, , locale] of [["en", 0, "en-US"], ["de", 0, "de-DE"], ["fr", 0, "fr-FR"], ["es", 0, "es-ES"], ["ar", 0, "ar-SA"], ["zh", 0, "zh-CN"]] as const) {
    spoken.length = 0;
    const stop = voice.speak("Hello. This is a test.", () => {}, code as any);
    check(`voix ${code} → ${locale}`, spoken[0]?.lang === locale, String(spoken[0]?.lang));
    stop();
  }
  spoken.length = 0;
  let ends = 0;
  voice.speak(long, () => ends++, "en");
  const totalChunks = (() => { let n = 1; return n; })();
  void totalChunks;
  const first = spoken[0].text;
  voice.pauseSpeaking();
  const countAtPause = spoken.length;
  spoken[0].fire("error"); // l'annulation du morceau en cours ne doit PAS terminer la lecture
  check("pause : la lecture n'est pas terminée", ends === 0);
  voice.resumeSpeaking();
  check("reprise : le même morceau est relu", spoken.length === countAtPause + 1 && spoken[spoken.length - 1].text === first);
  let guard = 0;
  while (ends === 0 && guard++ < 200) spoken[spoken.length - 1].fire("end");
  check("fin normale : onEnd appelé une seule fois", ends === 1, String(ends));
  spoken.length = 0; ends = 0;
  voice.speak(long, () => ends++, "en");
  voice.stopSpeaking();
  check("arrêt : onEnd appelé une seule fois", ends === 1, String(ends));
  voice.stopSpeaking();
  check("arrêt répété : pas de double appel", ends === 1);
  spoken.length = 0; let endsA = 0, endsB = 0;
  voice.speak(long, () => endsA++, "en");
  voice.speak("Hallo Welt. Das ist ein Test.", () => endsB++, "de");
  check("nouvelle lecture : l'ancienne se termine, une seule voix", endsA === 1 && spoken[spoken.length - 1].lang === "de-DE");


  console.log("8) Tests A–D : la langue de l'APPLICATION l'emporte sur celle du navigateur / système");
  const setBrowser = (lng: string) =>
    Object.defineProperty(globalThis, "navigator", { value: { language: lng, languages: [lng, "en"], userAgent: "test" }, configurable: true });
  const ctx: Record<string, string> = {};
  (globalThis as any).window = { ...(globalThis as any).window, localStorage: { getItem: (k: string) => ctx[k] ?? null, setItem: (k: string, v: string) => { ctx[k] = v; }, removeItem: (k: string) => { delete ctx[k]; } } };
  const client = await import("../lib/i18n/client");
  const NAT: Record<string, string> = {
    en: "Respond exclusively in English", de: "Antworte ausschließlich auf Deutsch", zh: "必须始终使用中文回答", fr: "Réponds exclusivement en français",
    es: "Responde exclusivamente en español", it: "Rispondi esclusivamente in italiano", pt: "Responde exclusivamente em português", ar: "أجب حصريًا باللغة العربية",
  };
  const abc: [string, string, string, string][] = [
    ["A", "fr-FR", "en", "English"], ["B", "fr-FR", "de", "German (Deutsch)"], ["C", "fr-FR", "zh", "Simplified Chinese (中文)"], ["D", "zh-CN", "en", "English"],
  ];
  for (const [id, browser, app, name] of abc) {
    setBrowser(browser);
    ctx["sh_lang"] = app; // l'utilisateur a choisi cette langue dans l'application
    const hdr = client.languageHeader();
    const resolved = await resolveLanguage(new Request("http://x", { headers: { ...hdr, "accept-language": browser } }), "u1", app);
    for (const engine of ["gemini", "gemini2"] as const) {
      calls = [];
      await runAi({ engine, prompt: "What is photosynthesis?", systemInstruction: "Tu es un assistant.", history: [{ role: "assistant", content: "La photosynthèse est un processus…" }, { role: "user", content: "Merci" }], lang: resolved });
      const sys = geminiSystem(calls[0]);
      const usr = geminiLastUser(calls[0]);
      check(`Test ${id} [${engine}] (navigateur ${browser}, app ${app}) : langue résolue = ${app}`, resolved === app, resolved);
      check(`Test ${id} [${engine}] : prompt système dynamique dans la langue ${app}`, sys.includes(NAT[app]));
      check(`Test ${id} [${engine}] : cible ${name} partout`, sys.includes(`TARGET LANGUAGE: ${name}`) && usr.includes(`TARGET LANGUAGE: ${name}`));
      check(`Test ${id} [${engine}] : le prompt « langue » est tout en haut`, sys.indexOf(NAT[app]) < sys.indexOf("SYSTEM INSTRUCTIONS"));
      check(`Test ${id} [${engine}] : aucune autre langue cible`, LANGS.filter(([c]) => c !== app).every(([, n]) => !sys.includes(`TARGET LANGUAGE: ${n}`)));
    }
  }

  console.log("9) Changement de langue en temps réel (fr → en → de → zh) : la requête suivante part avec la nouvelle langue");
  for (const next of ["fr", "en", "de", "zh", "en"]) {
    ctx["sh_lang"] = next;
    const req = new Request("http://x", { headers: client.languageHeader() });
    check(`après changement → ${next} : en-tête`, req.headers.get("x-app-language") === next);
    check(`après changement → ${next} : langue serveur`, (await resolveLanguage(req, "u1", next)) === next);
  }
  check("le corps de la requête l'emporte sur l'en-tête", (await resolveLanguage(new Request("http://x", { headers: { "x-app-language": "fr" } }), "u1", "de")) === "de");

  console.log("10) Garde anti-régression : aucune détection de langue système/navigateur");
  const clientFiles = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));
  const forbidden = [/navigator\.languages?\b/, /resolvedOptions\(\)\.locale/, /\bdefaultLocale\b/, /\bsystemLocale\b/, /\bbrowserLocale\b/, /\bdetectLanguage\b/, /\bautoDetectLanguage\b/, /\bdetectUserLanguage\b/, /[Aa]ccept-[Ll]anguage/];
  for (const f of clientFiles) {
    const src = readFileSync(f, "utf-8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const re of forbidden) check(`${f} ne contient pas ${re}`, !re.test(src));
  }


  console.log("11) Gemini n°2 = fonction anciennement OpenAI ; Gemini n°1 inchangé");
  {
    const { gemini2Model, GEMINI2_DEFAULT_MODEL } = await import("../lib/ai/gemini2");
    check("Gemini n°2 : modèle par défaut = gemini-3.5-flash-lite", gemini2Model() === "gemini-3.5-flash-lite" && GEMINI2_DEFAULT_MODEL === "gemini-3.5-flash-lite");
    process.env.GEMINI_PRACTICE_MODEL = "gemini-test-override";
    check("Gemini n°2 : modèle réglable (GEMINI_PRACTICE_MODEL)", gemini2Model() === "gemini-test-override");
    delete process.env.GEMINI_PRACTICE_MODEL;
    calls = [];
    await callGemini("x", undefined, false, [], { lang: "fr" });
    check("Gemini n°1 : endpoint et modèle inchangés (GEMINI_MODEL)", calls[0].url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", calls[0].url);
    check("aucun fichier « engine » / « openai » ne subsiste", (() => { try { readFileSync("lib/ai/openai.ts"); return false; } catch { return true; } })() && (() => { try { readFileSync("lib/ai/engine.ts"); return false; } catch { return true; } })());
  }
  // Pratique : Gemini n°2 seul, la langue cible lui est transmise, aucun appel OpenAI.
  for (const [code, name] of [["en", "English"], ["de", "German (Deutsch)"], ["es", "Spanish (Español)"], ["zh", "Simplified Chinese (中文)"]] as const) {
    calls = [];
    const d = routeAi({ mode: "exercise", message: "x" }, true);
    await runAi({ engine: d.engine, prompt: "Donne un exercice sur le cours français.", systemInstruction: "Pratique", history: [], lang: code });
    check(`Pratique (${code}) : Gemini n°2 appelé seul`, calls.length === 1 && who(calls[0]) === "gemini2");
    check(`Pratique (${code}) : cible ${name}`, gemini2System(calls[0]).includes(`TARGET LANGUAGE: ${name}`) && gemini2LastUser(calls[0]).includes(`TARGET LANGUAGE: ${name}`));
  }
  // Si Gemini n°2 n'est pas disponible, la pratique retombe sur Gemini n°1 (l'application reste utilisable).
  {
    calls = [];
    const d = routeAi({ mode: "exercise", message: "x" }, false);
    await runAi({ engine: d.engine, prompt: "Donne un exercice.", systemInstruction: "Pratique", history: [], lang: "en" });
    check("Gemini n°2 indisponible → Gemini n°1 seul", calls.length === 1 && who(calls[0]) === "gemini1");
  }
  // Historique conservé (même contexte) et format JSON conservé.
  {
    calls = [];
    await callGemini2("Corrige.", "s", [{ role: "user", content: "Q1" }, { role: "assistant", content: "R1" }], { lang: "de", json: true, temperature: 0.5 });
    const b = calls[0].body;
    check("Gemini n°2 : historique transmis", b.contents.length === 3 && b.contents[1].role === "model");
    check("Gemini n°2 : mode JSON transmis, température dépréciée NON envoyée", b.generationConfig.responseMimeType === "application/json" && b.generationConfig.temperature === undefined);
  }
  // Aucun appel OpenAI pendant toute la suite.
  check("aucun appel OpenAI effectué pendant les tests", calls.every((c) => !c.url.includes("openai")));

  console.log(`\n${passed} vérifications réussies, ${failed} échec(s).`);
  process.exit(failed ? 1 : 0);
}
main();
