import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// À brancher à l'étape 2 (voir README) : créer un projet Supabase,
// puis renseigner ces deux variables dans .env.local
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
