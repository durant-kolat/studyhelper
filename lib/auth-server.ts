import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type AuthenticatedUser = { id: string; email: string | null };

/**
 * Vérifie le jeton d'accès Supabase envoyé dans l'en-tête Authorization
 * et renvoie l'utilisateur réellement authentifié (id + e-mail) — jamais des
 * valeurs fournies par le corps de la requête, qui pourraient être falsifiées
 * par le client. Retourne null si le jeton est absent ou invalide.
 */
export async function getAuthenticatedUser(
  req: NextRequest
): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const client = createClient(supabaseUrl, anonKey);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    // Rend visible la vraie cause d'un « 401 » : jeton expiré (AuthApiError, status 401/403) ou serveur qui n'arrive pas
    // à joindre Supabase (AuthRetryableFetchError / « fetch failed » / délai dépassé) — réseau, DNS, VPN, URL erronée.
    if (error) console.error(`[auth] vérification du jeton impossible : ${error.name} (status ${error.status ?? "n/a"}) — ${error.message}`);
    return null;
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Variante historique : seulement l'id de l'utilisateur authentifié. */
export async function getAuthenticatedUserId(
  req: NextRequest
): Promise<string | null> {
  const user = await getAuthenticatedUser(req);
  return user?.id ?? null;
}
