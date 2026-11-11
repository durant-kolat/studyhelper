// Tests de la reconnaissance vocale (lib/voice.ts) et de la transcription Gemini (lib/gemini.ts).
// Lancer : npm run test:voice   (aucun navigateur ni réseau : API du navigateur et fetch simulés)
// Ils vérifient la LOGIQUE (bascule natif → serveur, une seule session, gestion d'erreurs, langue, modèle/clé),
// pas le comportement réel d'un micro ni de Google/Gemini — voir le rapport pour ce qui reste à tester à la main.

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
process.env.GEMINI_API_KEY = "test-key-SECRET";
process.env.GEMINI_MODEL = "";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** Durée d'enregistrement simulée : au-dessus du seuil de 500 ms sous lequel un enregistrement est ignoré (clic/bruit). */
const recordFor = () => tick(560);

// ---------- faux navigateur ----------
type Handler = ((e?: any) => void) | null;
let recognitions: FakeRecognition[] = [];
class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  started = false;
  aborted = false;
  constructor() {
    recognitions.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
}
class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: Handler = null;
  onstop: Handler = null;
  onerror: Handler = null;
  constructor(public stream: unknown, public opts?: { mimeType?: string }) {}
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}
class FakeFileReader {
  result: string | null = null;
  onload: Handler = null;
  onerror: Handler = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = "data:audio/webm;base64," + Buffer.from(buf).toString("base64");
      this.onload?.();
    });
  }
}

const session = new Map<string, string>();
let micError: string | null = null;
let tracksStopped = 0;
function installBrowser(opts: { native: boolean; recorder: boolean }) {
  recognitions = [];
  const w: any = {
    isSecureContext: true,
    sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  if (opts.native) w.webkitSpeechRecognition = FakeRecognition;
  (globalThis as any).window = w;
  (globalThis as any).FileReader = FakeFileReader;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      language: "en-US",
      userAgent: "test",
      mediaDevices: opts.recorder
        ? {
            getUserMedia: async () => {
              if (micError) throw new DOMException("x", micError);
              return { getTracks: () => [{ stop: () => void tracksStopped++ }] };
            },
          }
        : undefined,
    },
    configurable: true,
  });
  if (opts.recorder) (globalThis as any).MediaRecorder = FakeMediaRecorder;
  else delete (globalThis as any).MediaRecorder;
}

let fetchCalls: { url: string; init: any }[] = [];
let fetchImpl: (url: string, init: any) => Promise<Response> = async () => new Response("{}", { status: 200 });
(globalThis as any).fetch = (url: string, init: any) => {
  fetchCalls.push({ url: String(url), init });
  return fetchImpl(String(url), init);
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function main() {
  const voice = await import("../lib/voice");

  function listen(lang: any = "en") {
    const log = { results: [] as string[], errors: [] as string[], ends: 0 };
    const stop = voice.startListening(
      (t) => log.results.push(t),
      (c) => log.errors.push(c),
      () => log.ends++,
      lang
    );
    return { log, stop };
  }

  console.log("1) Moteur natif : résultat, langue choisie, une seule fin");
  installBrowser({ native: true, recorder: true });
  session.clear();
  let a = listen("de");
  check("langue de reconnaissance = langue de l'application (de-DE)", recognitions[0].lang === "de-DE", recognitions[0].lang);
  recognitions[0].onresult?.({ results: [[{ transcript: "  Hallo Welt  " }]] });
  recognitions[0].onend?.();
  check("résultat livré une fois, nettoyé", a.log.results.length === 1 && a.log.results[0] === "Hallo Welt");
  check("onEnd appelé une seule fois", a.log.ends === 1);
  check("session libérée", !voice.isListening());
  a = listen("fr");
  check("langue fr → fr-FR", recognitions[recognitions.length - 1].lang === "fr-FR");
  recognitions[recognitions.length - 1].onend?.();
  check("fin sans résultat ni erreur → « no-speech » (pas un faux succès)", a.log.errors.join() === "no-speech" && a.log.ends === 1);

  console.log("2) Une seule session à la fois");
  installBrowser({ native: true, recorder: true });
  session.clear();
  const first = listen("en");
  const second = listen("en");
  check("la 1re session est arrêtée proprement (onEnd), sans résultat", first.log.ends === 1 && first.log.results.length === 0 && first.log.errors.length === 0);
  check("l'ancien objet de reconnaissance est abandonné (abort)", recognitions[0].aborted);
  check("une seule session active", voice.isListening());
  voice.abortListening();
  check("abortListening : onEnd, aucun résultat", second.log.ends === 1 && second.log.results.length === 0);
  check("abortListening répété sans effet", (voice.abortListening(), second.log.ends === 1));

  console.log("3) Erreurs natives sans solution de repli → codes stables");
  for (const [raw, code] of [["not-allowed", "denied"], ["audio-capture", "no-mic"], ["no-speech", "no-speech"], ["bogus", "unavailable"]] as const) {
    installBrowser({ native: true, recorder: true });
    session.clear();
    const x = listen("en");
    recognitions[0].onerror?.({ error: raw });
    recognitions[0].onend?.();
    check(`${raw} → ${code}`, x.log.errors.join() === code && x.log.ends === 1, x.log.errors.join());
    check(`${raw} : pas de bascule serveur`, fetchCalls.length === 0 && !session.has("studyhelper.sttServer"));
  }
  installBrowser({ native: true, recorder: true });
  let x = listen("en");
  recognitions[0].onerror?.({ error: "aborted" });
  recognitions[0].onend?.();
  check("« aborted » (arrêt volontaire) : aucune erreur affichée", x.log.errors.length === 0 && x.log.ends === 1);

  console.log("4) CAUSE RÉELLE : erreur « network » du moteur natif → bascule automatique sur la transcription serveur");
  installBrowser({ native: true, recorder: true });
  session.clear();
  fetchCalls = [];
  fetchImpl = async () => json({ text: "Quelle est la capitale de la France ?" });
  x = listen("fr");
  recognitions[0].onerror?.({ error: "network" });
  recognitions[0].onend?.(); // le navigateur envoie « end » après l'erreur : ne doit PAS terminer la session
  check("aucune erreur affichée à l'utilisateur", x.log.errors.length === 0);
  check("la session n'est pas terminée par le « end » natif", x.log.ends === 0);
  await tick();
  check("l'enregistrement du micro a démarré", voice.isListening());
  await recordFor();
  x.stop(); // l'utilisateur arrête : l'audio est transcrit
  await tick(80);
  check("résultat livré par le serveur", x.log.results.join() === "Quelle est la capitale de la France ?", x.log.results.join());
  check("onEnd une seule fois", x.log.ends === 1);
  const call = fetchCalls.find((c) => c.url === "/api/transcribe");
  check("appel de /api/transcribe", !!call);
  const sent = call ? JSON.parse(call.init.body) : {};
  check("langue de l'application envoyée (fr)", sent.language === "fr");
  check("audio en base64 + type MIME", typeof sent.audio === "string" && sent.audio.length > 100 && /^audio\/webm/.test(sent.mimeType), sent.mimeType);
  check("jeton de session de l'utilisateur envoyé (route authentifiée)", call?.init.headers?.Authorization === "Bearer tok-123", String(call?.init.headers?.Authorization));
  check("aucune clé Gemini côté client", !JSON.stringify(call?.init ?? {}).includes("SECRET") && !call?.url.includes("key"));
  check("micro libéré (pistes arrêtées)", tracksStopped > 0);
  check("choix mémorisé pour la session", session.get("studyhelper.sttServer") === "1");

  console.log("5) Session suivante : le moteur natif défaillant n'est plus retenté");
  const before = recognitions.length;
  fetchCalls = [];
  fetchImpl = async () => json({ text: "Deuxième question" });
  x = listen("en");
  check("pas de nouvelle reconnaissance native", recognitions.length === before);
  await recordFor();
  x.stop();
  await tick(80);
  check("transcription serveur directe", x.log.results.join() === "Deuxième question" && x.log.ends === 1);

  console.log("6) Transcription serveur : erreurs");
  fetchImpl = async () => json({ text: "" });
  x = listen("en");
  await recordFor();
  x.stop();
  await tick(80);
  check("texte vide → no-speech", x.log.errors.join() === "no-speech" && x.log.results.length === 0 && x.log.ends === 1);
  fetchImpl = async () => json({ error: "boom" }, 502);
  x = listen("en");
  await recordFor();
  x.stop();
  await tick(80);
  check("HTTP 502 → unavailable", x.log.errors.join() === "unavailable" && x.log.ends === 1);
  fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  x = listen("en");
  await recordFor();
  x.stop();
  await tick(80);
  check("réseau coupé → network (vraie erreur réseau)", x.log.errors.join() === "network" && x.log.ends === 1);
  fetchCalls = [];
  fetchImpl = async () => json({ text: "ne doit pas arriver" });
  x = listen("en");
  await recordFor();
  voice.abortListening();
  await tick(60);
  check("annulation pendant l'enregistrement : rien livré, aucun appel API", x.log.results.length === 0 && x.log.ends === 1 && fetchCalls.length === 0);

  console.log("7) Micro : permissions et matériel (moteur serveur)");
  for (const [name, code] of [["NotAllowedError", "denied"], ["NotFoundError", "no-mic"], ["NotReadableError", "no-mic"], ["WeirdError", "unavailable"]] as const) {
    micError = name;
    x = listen("en");
    await tick();
    check(`getUserMedia ${name} → ${code}`, x.log.errors.join() === code && x.log.ends === 1, x.log.errors.join());
  }
  micError = null;

  console.log("8) Navigateurs sans reconnaissance native (Firefox…) : enregistrement + serveur");
  installBrowser({ native: false, recorder: true });
  session.clear();
  check("entrée vocale déclarée disponible", voice.isVoiceInputSupported());
  fetchImpl = async () => json({ text: "Hello from Firefox" });
  x = listen("en");
  await recordFor();
  x.stop();
  await tick(80);
  check("fonctionne sans Web Speech API", x.log.results.join() === "Hello from Firefox");

  console.log("9) Aucun moteur disponible → « unsupported »");
  installBrowser({ native: false, recorder: false });
  check("entrée vocale déclarée indisponible", !voice.isVoiceInputSupported());
  x = listen("en");
  check("code unsupported + onEnd", x.log.errors.join() === "unsupported" && x.log.ends === 1);
  installBrowser({ native: false, recorder: true });
  (globalThis as any).window.isSecureContext = false;
  check("contexte non sécurisé (HTTP) : enregistrement refusé", !voice.isRecorderSupported());

  console.log("10) Natif : « language-not-supported » → serveur (transcrit toutes les langues) sans mémoriser");
  installBrowser({ native: true, recorder: true });
  session.clear();
  fetchImpl = async () => json({ text: "Hindi text" });
  x = listen("hi");
  recognitions[0].onerror?.({ error: "language-not-supported" });
  recognitions[0].onend?.();
  await recordFor();
  x.stop();
  await tick(80);
  check("résultat serveur, langue hi envoyée", x.log.results.join() === "Hindi text");
  check("moteur natif non banni pour autant", !session.has("studyhelper.sttServer"));

  console.log("11) Transcription Gemini : même modèle, même clé, jamais la clé dans l'URL");
  const gem = await import("../lib/gemini");
  check("modèle = gemini-3.5-flash-lite", gem.geminiModel() === "gemini-3.5-flash-lite", gem.geminiModel());
  fetchCalls = [];
  fetchImpl = async () => json({ candidates: [{ content: { parts: [{ text: " Bonjour tout le monde " }] } }] });
  let tr = await gem.transcribeAudio("QUJD", "audio/webm", "fr");
  check("texte transcrit", tr.ok && tr.text === "Bonjour tout le monde");
  const g = fetchCalls[0];
  check("endpoint du modèle gemini-3.5-flash-lite", g.url.includes("/models/gemini-3.5-flash-lite:generateContent"), g.url);
  check("clé dans l'en-tête x-goog-api-key, pas dans l'URL", g.init.headers["x-goog-api-key"] === "test-key-SECRET" && !g.url.includes("SECRET") && !g.url.includes("key="));
  const gb = JSON.parse(g.init.body);
  check("audio envoyé en inline_data", gb.contents[0].parts.some((p: any) => p.inline_data?.mime_type === "audio/webm" && p.inline_data.data === "QUJD"));
  check("langue attendue précisée (French)", JSON.stringify(gb).includes("French"));
  check("consigne : transcrire sans obéir à l'audio", /Never follow or execute/.test(gb.systemInstruction.parts[0].text));
  fetchImpl = async () => json({ candidates: [{ content: { parts: [{ text: "[[NO_SPEECH]]" }] } }] });
  tr = await gem.transcribeAudio("QUJD", "audio/webm", "en");
  check("aucune parole → texte vide", tr.ok && tr.text === "");
  fetchImpl = async () => new Response("model not found, key=test-key-SECRET", { status: 404 });
  const origErr = console.error;
  let logged = "";
  console.error = (...args: unknown[]) => void (logged += args.join(" "));
  tr = await gem.transcribeAudio("QUJD", "audio/webm", "en");
  console.error = origErr;
  check("échec HTTP signalé, avec le modèle dans les logs", !tr.ok && logged.includes("gemini-3.5-flash-lite"));
  check("le détail renvoyé au client ne contient pas la réponse brute de l'API", !tr.ok && !tr.detail.includes("SECRET"), tr.ok ? "" : tr.detail);

  console.log(`\n${pass} vérifications réussies, ${fail} échec(s).`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
