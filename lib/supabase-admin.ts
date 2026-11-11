import { createClient } from "@supabase/supabase-js";

// Réservé aux routes serveur (app/api/**) — ne jamais importer ce fichier
// dans un composant client : la clé service_role contourne les règles RLS.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
