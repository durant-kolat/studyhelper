// Tests de la protection anti-brute-force de la connexion (lib/login-guard.ts) — SANS Supabase réel.
// Exécution : npx tsx tests/login-guard.test.ts   (ou : npm run test:login)
//   ou sans dépendance : node --experimental-strip-types tests/login-guard.test.ts
// Ce que ces tests NE prouvent PAS : le comportement des vraies fonctions SQL ni de Supabase Auth (voir README,
// vérification à la main : se tromper 5 fois de mot de passe, puis constater le blocage).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const load = (p: string) => import(new URL(p, import.meta.url).href);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const { LOGIN_RPC, LOGIN_MESSAGES, checkLoginAllowed, recordLoginResult, classifyAuthError, handleLogin } = await load("../lib/login-guard.ts");

const EMAIL = "eleve.secret@example.com";
const GOOD_PASSWORD = "MotDePasseCorrect!42";
const BAD_PASSWORD = "MauvaisMotDePasse#99";

// --- Faux Supabase : même règle que check_login_allowed / record_login_result (5 échecs dans la fenêtre → blocage) ---
type Opts = { failCheck?: "error" | "throw" | "garbage"; failRecord?: boolean; authDown?: "network" | "5xx" | "429" | "throw"; shape?: "table" };
function makeWorld(opts: Opts = {}) {
  const log: { email: string; success: boolean }[] = [];
  const calls = { check: 0, record: 0, signIn: 0 };
  const paramsSeen: string[][] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      paramsSeen.push(Object.keys(args));
      if (fn === LOGIN_RPC.check) {
        calls.check++;
        if (opts.failCheck === "throw") throw new Error("connect ECONNREFUSED 10.0.0.1:5432 secret-host");
        if (opts.failCheck === "error") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.check_login_allowed(p_email) in the schema cache" } };
        if (opts.failCheck === "garbage") return { data: "oops", error: null };
        const fails = log.filter((l) => l.email === args[LOGIN_RPC.emailParam] && !l.success).length;
        // Par défaut : forme de la base réelle (booléen seul). shape "table" : ancienne forme { allowed, seconds_left }.
        if (opts.shape === "table") {
          return fails >= 5 ? { data: [{ allowed: false, seconds_left: 87 }], error: null } : { data: [{ allowed: true, seconds_left: 0 }], error: null };
        }
        return { data: fails < 5, error: null };
      }
      calls.record++;
      if (opts.failRecord) return { data: null, error: { code: "42501", message: "permission denied for table login_attempts" } };
      log.push({ email: String(args[LOGIN_RPC.emailParam]), success: Boolean(args[LOGIN_RPC.successParam]) });
      return { data: null, error: null };
    },
  };
  const signIn = async (_email: string, password: string) => {
    calls.signIn++;
    if (opts.authDown === "throw") throw new Error("fetch failed: getaddrinfo ENOTFOUND project.supabase.co");
    if (opts.authDown) return { ok: false, kind: "unavailable" };
    return password === GOOD_PASSWORD
      ? { ok: true, accessToken: "access-token-xyz", refreshToken: "refresh-token-xyz" }
      : { ok: false, kind: "invalid" };
  };
  return { deps: { admin, signIn }, log, calls, paramsSeen };
}

// Capture de console.error pour vérifier ce qui est journalisé.
async function withCapturedErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    return { result: await fn(), logged: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("1. Connexion valide");
await test("une connexion valide renvoie les jetons et enregistre un succès", async () => {
  const w = makeWorld();
  const r = await handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { accessToken: "access-token-xyz", refreshToken: "refresh-token-xyz" });
  assert.deepEqual(w.log, [{ email: EMAIL, success: true }]);
  assert.deepEqual(w.calls, { check: 1, record: 1, signIn: 1 });
});

console.log("2. Mauvais mot de passe");
await test("un mauvais mot de passe renvoie 401 générique et enregistre un échec", async () => {
  const w = makeWorld();
  const r = await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: LOGIN_MESSAGES.invalid });
  assert.deepEqual(w.log, [{ email: EMAIL, success: false }]);
});
await test("le message ne dit pas si l'adresse existe (même réponse pour tout compte inconnu)", async () => {
  const a = await handleLogin(makeWorld().deps, { email: "inconnu@example.com", password: BAD_PASSWORD });
  const b = await handleLogin(makeWorld().deps, { email: EMAIL, password: BAD_PASSWORD });
  assert.deepEqual(a, b);
});

console.log("3. Tentatives répétées");
await test("5 échecs puis blocage 429 au 6e essai, même avec le bon mot de passe", async () => {
  const w = makeWorld();
  for (let i = 0; i < 5; i++) assert.equal((await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD })).status, 401);
  const sixth = await handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD });
  assert.equal(sixth.status, 429);
  assert.equal("lockedSecondsLeft" in sixth.body, false); // la base réelle ne fournit pas la durée
  assert.match(String(sixth.body.error), /quelques minutes/);
});
await test("ancienne forme { allowed, seconds_left } toujours acceptée : durée restante affichée", async () => {
  const w = makeWorld({ shape: "table" });
  for (let i = 0; i < 5; i++) await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD });
  const r = await handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD });
  assert.equal(r.status, 429);
  assert.equal(r.body.lockedSecondsLeft, 87);
  assert.match(String(r.body.error), /87s/);
});
await test("checkLoginAllowed : true → autorisé, false → bloqué, autre forme → indisponible (échec fermé)", async () => {
  const mk = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
  assert.deepEqual(await checkLoginAllowed(mk(true), EMAIL), { status: "allowed" });
  assert.deepEqual(await checkLoginAllowed(mk(false), EMAIL), { status: "blocked", secondsLeft: null });
  assert.deepEqual(await checkLoginAllowed(mk([{ allowed: false, seconds_left: 12 }]), EMAIL), { status: "blocked", secondsLeft: 12 });
  const { result } = await withCapturedErrors(async () => [await checkLoginAllowed(mk(null), EMAIL), await checkLoginAllowed(mk("true"), EMAIL), await checkLoginAllowed(mk([]), EMAIL)]);
  for (const r of result) assert.deepEqual(r, { status: "unavailable" });
});
await test("le blocage d'un compte n'affecte pas un autre compte", async () => {
  const w = makeWorld();
  for (let i = 0; i < 5; i++) await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD });
  assert.equal((await handleLogin(w.deps, { email: "autre@example.com", password: GOOD_PASSWORD })).status, 200);
});

console.log("4. Une tentative bloquée n'atteint pas l'authentification");
await test("bloquée : signIn non appelé et rien d'enregistré", async () => {
  const w = makeWorld();
  for (let i = 0; i < 5; i++) await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD });
  const signInBefore = w.calls.signIn;
  const logBefore = w.log.length;
  await handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD });
  await handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD });
  assert.equal(w.calls.signIn, signInBefore);
  assert.equal(w.log.length, logBefore);
});

console.log("5. Une erreur RPC ne désactive pas la protection");
for (const mode of ["error", "throw", "garbage"] as const) {
  await test(`contrôle en panne (${mode}) : tentative refusée (503), authentification jamais appelée`, async () => {
    const w = makeWorld({ failCheck: mode });
    const { result } = await withCapturedErrors(() => handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD }));
    assert.equal(result.status, 503);
    assert.equal(w.calls.signIn, 0);
    assert.equal(w.calls.record, 0);
  });
}
await test("l'enregistrement en panne est journalisé mais ne bloque pas une connexion valide", async () => {
  const w = makeWorld({ failRecord: true });
  const { result, logged } = await withCapturedErrors(() => handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD }));
  assert.equal(result.status, 200);
  assert.match(logged, /record_login_result/);
});
await test("l'enregistrement en panne ne transforme pas un mauvais mot de passe en succès", async () => {
  const w = makeWorld({ failRecord: true });
  const { result } = await withCapturedErrors(() => handleLogin(w.deps, { email: EMAIL, password: BAD_PASSWORD }));
  assert.equal(result.status, 401);
});
await test("panne de l'authentification (réseau / 5xx / 429 / exception) : 503, tentative NON comptée comme échec", async () => {
  for (const authDown of ["network", "5xx", "429", "throw"] as const) {
    const w = makeWorld({ authDown });
    const { result } = await withCapturedErrors(() => handleLogin(w.deps, { email: EMAIL, password: GOOD_PASSWORD }));
    assert.equal(result.status, 503, authDown);
    assert.equal(w.log.length, 0, authDown);
  }
});
await test("classifyAuthError : identifiants refusés ≠ panne", () => {
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 400 }), "invalid");
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 422 }), "invalid");
  assert.equal(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 }), "unavailable");
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 500 }), "unavailable");
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 429 }), "unavailable");
});
await test("checkLoginAllowed / recordLoginResult n'envoient que les paramètres déclarés dans LOGIN_RPC", async () => {
  const w = makeWorld();
  await checkLoginAllowed(w.deps.admin, EMAIL);
  await recordLoginResult(w.deps.admin, EMAIL, false);
  assert.deepEqual(w.paramsSeen[0], [LOGIN_RPC.emailParam]);
  assert.deepEqual(w.paramsSeen[1], [LOGIN_RPC.emailParam, LOGIN_RPC.successParam]);
});

console.log("6. Les erreurs ne divulguent rien de sensible");
await test("réponses client et journaux sans mot de passe, jeton, e-mail, nom de fonction ni détail technique", async () => {
  const secrets = [EMAIL, GOOD_PASSWORD, BAD_PASSWORD, "access-token-xyz", "refresh-token-xyz", "ECONNREFUSED", "secret-host", "ENOTFOUND", "supabase.co", "PGRST202", "p_email", "check_login_allowed"];
  const scenarios: Opts[] = [{ failCheck: "error" }, { failCheck: "throw" }, { failCheck: "garbage" }, { failRecord: true }, { authDown: "throw" }, { authDown: "5xx" }, {}];
  for (const opts of scenarios) {
    for (const password of [GOOD_PASSWORD, BAD_PASSWORD]) {
      const { result, logged } = await withCapturedErrors(() => handleLogin(makeWorld(opts).deps, { email: EMAIL, password }));
      // Le client ne reçoit jamais de détail technique. (Le jeton n'est renvoyé que dans la réponse 200 attendue.)
      const clientText = result.status === 200 ? "" : JSON.stringify(result.body);
      for (const s of secrets) assert.equal(clientText.includes(s), false, `client: "${s}" dans ${JSON.stringify(opts)}`);
      // Les journaux serveur ne contiennent ni e-mail, ni mot de passe, ni jeton.
      for (const s of [EMAIL, GOOD_PASSWORD, BAD_PASSWORD, "access-token-xyz", "refresh-token-xyz"]) {
        assert.equal(logged.includes(s), false, `journal: "${s}" dans ${JSON.stringify(opts)}`);
      }
    }
  }
});

console.log("Accord avec les fonctions SQL (signatures, autorisations)");
const sqlDir = new URL("../supabase/", import.meta.url);
const sqlFiles = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));
await test("toutes les définitions SQL de check_login_allowed / record_login_result utilisent les paramètres de LOGIN_RPC", () => {
  const checkNames = new Set<string>();
  const recordNames = new Set<string>();
  for (const f of sqlFiles) {
    const sql = readFileSync(new URL(f, sqlDir), "utf8");
    for (const m of sql.matchAll(/function\s+public\.check_login_allowed\s*\(\s*(\w+)\s+text\s*\)/gi)) checkNames.add(m[1]);
    for (const m of sql.matchAll(/function\s+public\.record_login_result\s*\(\s*(\w+)\s+text\s*,\s*(\w+)\s+boolean\s*\)/gi)) {
      recordNames.add(m[1]);
      assert.equal(m[2], LOGIN_RPC.successParam, `${f} : paramètre booléen`);
    }
  }
  assert.deepEqual([...checkNames], [LOGIN_RPC.emailParam], "check_login_allowed");
  assert.deepEqual([...recordNames], [LOGIN_RPC.emailParam], "record_login_result");
});
await test("la migration v2.6 reprend la définition réelle : check_login_allowed renvoie un booléen", () => {
  const sql = read("../supabase/migration-v2.6-login-functions.sql");
  assert.match(sql, /function public\.check_login_allowed\(p_email text\)\s+returns boolean/i);
  assert.match(sql, /function public\.record_login_result\(p_email text, p_success boolean\)\s+returns void/i);
});
await test("les deux fonctions sont réservées à service_role (retirées de public, anon, authenticated)", () => {
  for (const file of ["../supabase/migration-v1.4-schema-alignment.sql", "../supabase/migration-v2.6-login-functions.sql"]) {
    const sql = read(file);
    for (const fn of ["check_login_allowed(text)", "record_login_result(text, boolean)"]) {
      assert.match(sql, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")} to service_role`), file);
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, "\\$&")} from public, anon, authenticated`), file);
    }
  }
});

console.log("7–8. Réinitialisation du mot de passe et reste de l'application (vérifications STATIQUES)");
await test("mot de passe oublié / réinitialisation : toujours branchés sur Supabase Auth, sans lien avec la protection de connexion", () => {
  const forgot = read("../app/forgot-password/page.tsx");
  const reset = read("../app/reset-password/page.tsx");
  assert.match(forgot, /resetPasswordForEmail/);
  assert.match(reset, /updateUser/);
  for (const src of [forgot, reset]) {
    assert.equal(/login-guard|api\/auth\/login|check_login_allowed|record_login_result/.test(src), false);
  }
});
await test("seule la route de connexion utilise login-guard ; la page de connexion appelle toujours /api/auth/login", () => {
  const users: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(e.name) && /login-guard/.test(readFileSync(child, "utf8")) && !/login-guard\.(test\.)?ts$/.test(e.name)) users.push(child.pathname.split("/app/").pop() ?? e.name);
    }
  };
  for (const d of ["../app/", "../lib/", "../components/"]) walk(new URL(d, import.meta.url));
  assert.deepEqual(users, ["api/auth/login/route.ts"]);
  assert.match(read("../app/login/page.tsx"), /fetch\("\/api\/auth\/login"/);
});
await test("la route de connexion ne contient aucun nom de paramètre SQL en dur et ne journalise ni mot de passe ni jeton", () => {
  const route = read("../app/api/auth/login/route.ts");
  assert.equal(/p_identifier|p_email/.test(route), false);
  assert.equal(/console\.(log|error|warn)\([^)]*(password|token|email)/i.test(route), false);
});

console.log(`\n${passed} tests réussis${process.exitCode ? " — AU MOINS UN ÉCHEC" : ""}`);
