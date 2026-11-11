import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { classifyAuthError, handleLogin, LOGIN_MESSAGES, type LoginDeps } from "@/lib/login-guard";
import { z } from "zod";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// Client "normal" (clé anon) pour tenter la connexion elle-même — la
// vérification anti-brute-force, elle, passe par supabaseAdmin car les
// fonctions check_login_allowed / record_login_result ne sont pas
// exposées au client. Toute la logique (ordre des appels, échec fermé,
// erreurs sûres) est dans lib/login-guard.ts, testée sans Supabase.
const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

const deps: LoginDeps = {
  admin: {
    rpc: async (fn, args) => {
      const { data, error } = await supabaseAdmin.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
  },
  signIn: async (email, password) => {
    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });
    if (error || !data.session) return { ok: false, kind: classifyAuthError(error) };
    return { ok: true, accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  },
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;

  // Un seul compteur par email — suffisant contre un script qui essaie
  // beaucoup de mots de passe sur UN compte ciblé (le cas le plus
  // courant). Une vraie protection anti-scan multi-comptes ajouterait
  // aussi un compteur par IP (x-forwarded-for), pas fait ici.
  try {
    const { status, body: payload } = await handleLogin(deps, { email, password });
    return NextResponse.json(payload, { status });
  } catch {
    console.error("[login] erreur inattendue");
    return NextResponse.json({ error: LOGIN_MESSAGES.unavailable }, { status: 503 });
  }
}
