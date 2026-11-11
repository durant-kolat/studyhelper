// Protection anti-brute-force de la connexion : logique PURE (aucun import), testable sans Supabase.
// Utilisée par app/api/auth/login/route.ts.
//
// Principes :
//  - le contrôle (check_login_allowed) passe AVANT l'authentification ; une tentative bloquée n'atteint jamais Supabase Auth ;
//  - si le contrôle échoue (erreur technique, réponse inattendue), on REFUSE la tentative (503) : la protection n'est jamais
//    contournée en silence (avant, l'erreur était ignorée et chaque tentative passait) ;
//  - une panne de l'authentification elle-même (réseau, 5xx, limite Supabase) n'est pas comptée comme un mauvais mot de passe ;
//  - aucune réponse client ni aucun journal ne contient mot de passe, jeton, clé ou adresse e-mail ; les messages ne disent
//    jamais si une adresse existe.

/** Noms RÉELS des fonctions SQL et de leur paramètre (base Supabase en production : p_email ; supabase/migration-v2.6-login-functions.sql). Un test vérifie cet accord. */
export const LOGIN_RPC = {
  check: "check_login_allowed",
  record: "record_login_result",
  emailParam: "p_email",
  successParam: "p_success",
} as const;

export type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

// secondsLeft = null quand la fonction SQL ne le fournit pas (cas de la base réelle : elle renvoie seulement vrai/faux).
export type LoginCheck = { status: "allowed" } | { status: "blocked"; secondsLeft: number | null } | { status: "unavailable" };

/** Journal serveur sûr : code et message techniques de PostgREST uniquement (jamais l'e-mail, le mot de passe ni un jeton). */
function logRpcFailure(fn: string, error: { code?: string; message?: string } | null, reason: string) {
  console.error(`[login-guard] ${fn} : ${reason}`, { code: error?.code ?? null, message: (error?.message ?? "").slice(0, 200) });
}

/** Appelle check_login_allowed. Toute erreur ou réponse inattendue → "unavailable" (échec fermé). */
export async function checkLoginAllowed(client: RpcClient, email: string): Promise<LoginCheck> {
  let res: RpcResult;
  try {
    res = await client.rpc(LOGIN_RPC.check, { [LOGIN_RPC.emailParam]: email });
  } catch (e) {
    logRpcFailure(LOGIN_RPC.check, { message: e instanceof Error ? e.message : "exception" }, "appel impossible");
    return { status: "unavailable" };
  }
  if (res.error) {
    logRpcFailure(LOGIN_RPC.check, res.error, "erreur RPC");
    return { status: "unavailable" };
  }
  // Deux formes acceptées : booléen seul (base réelle : vrai = connexion autorisée) ou ligne { allowed, seconds_left }.
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  const allowed = typeof row === "boolean" ? row : (row as { allowed?: unknown } | null | undefined)?.allowed;
  if (typeof allowed !== "boolean") {
    logRpcFailure(LOGIN_RPC.check, null, "réponse inattendue");
    return { status: "unavailable" };
  }
  if (allowed) return { status: "allowed" };
  const raw = typeof row === "boolean" ? NaN : Number((row as { seconds_left?: unknown }).seconds_left);
  return { status: "blocked", secondsLeft: Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null };
}

/** Appelle record_login_result. Renvoie false (et journalise) en cas d'échec ; ne lève jamais d'exception. */
export async function recordLoginResult(client: RpcClient, email: string, success: boolean): Promise<boolean> {
  try {
    const res = await client.rpc(LOGIN_RPC.record, { [LOGIN_RPC.emailParam]: email, [LOGIN_RPC.successParam]: success });
    if (res.error) {
      logRpcFailure(LOGIN_RPC.record, res.error, "enregistrement impossible");
      return false;
    }
    return true;
  } catch (e) {
    logRpcFailure(LOGIN_RPC.record, { message: e instanceof Error ? e.message : "exception" }, "enregistrement impossible");
    return false;
  }
}

export type SignInResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; kind: "invalid" | "unavailable" };

/** Distingue « identifiants refusés » (compte comme un échec) d'une panne de l'authentification (ne compte pas). */
export function classifyAuthError(error: { name?: string; status?: number } | null | undefined): "invalid" | "unavailable" {
  if (!error) return "invalid";
  const status = error.status ?? 0;
  if (error.name === "AuthRetryableFetchError" || status === 0 || status === 429 || status >= 500) return "unavailable";
  return "invalid";
}

export interface LoginDeps {
  admin: RpcClient;
  signIn(email: string, password: string): Promise<SignInResult>;
}

export type LoginResponse = { status: number; body: Record<string, unknown> };

export const LOGIN_MESSAGES = {
  invalid: "Email ou mot de passe incorrect.",
  unavailable: "Connexion momentanément indisponible. Réessaie dans un instant.",
} as const;

/** Déroulé complet d'une tentative de connexion (entrées déjà validées, e-mail en minuscules). */
export async function handleLogin(deps: LoginDeps, input: { email: string; password: string }): Promise<LoginResponse> {
  const { email, password } = input;

  const check = await checkLoginAllowed(deps.admin, email);
  if (check.status === "unavailable") {
    return { status: 503, body: { error: LOGIN_MESSAGES.unavailable } };
  }
  if (check.status === "blocked") {
    // Une tentative bloquée n'atteint ni l'authentification ni le journal (la fenêtre de blocage n'est pas prolongée).
    // Fenêtre de 2 minutes : sans durée exacte fournie par la base, on reste volontairement vague.
    const wait = check.secondsLeft === null ? "quelques minutes" : `${check.secondsLeft}s`;
    return {
      status: 429,
      body: {
        error: `Trop de tentatives échouées — réessaie dans ${wait}.`,
        ...(check.secondsLeft === null ? {} : { lockedSecondsLeft: check.secondsLeft }),
      },
    };
  }

  let result: SignInResult;
  try {
    result = await deps.signIn(email, password);
  } catch {
    result = { ok: false, kind: "unavailable" };
  }

  if (!result.ok && result.kind === "unavailable") {
    // Panne côté authentification : pas un mauvais mot de passe, on ne compte pas la tentative.
    console.error("[login-guard] authentification momentanément indisponible");
    return { status: 503, body: { error: LOGIN_MESSAGES.unavailable } };
  }

  // Un échec d'enregistrement est journalisé côté serveur ; il ne change pas la réponse faite au client.
  await recordLoginResult(deps.admin, email, result.ok);

  if (!result.ok) {
    // Message volontairement générique — ne précise jamais si c'est l'email ou le mot de passe qui est incorrect.
    return { status: 401, body: { error: LOGIN_MESSAGES.invalid } };
  }
  return { status: 200, body: { accessToken: result.accessToken, refreshToken: result.refreshToken } };
}
