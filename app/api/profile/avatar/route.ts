import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import {
  AVATAR_BUCKET,
  AVATAR_EXTENSIONS,
  AVATAR_FORMAT_ERROR,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_SIZE_ERROR,
  detectImageMime,
} from "@/lib/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIGRATION_HINT =
  "La photo de profil n'est pas encore activée sur le serveur (migration V1.9 à exécuter). Réessaie plus tard.";

const fail = (error: string, status: number, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status });

let bucketReady = false;

/** Crée (ou remet d'aplomb) le bucket PUBLIC « avatars » : rien à faire à la main. */
async function ensureAvatarBucket() {
  if (bucketReady) return;
  const options = {
    public: true,
    fileSizeLimit: AVATAR_MAX_BYTES,
    allowedMimeTypes: [...AVATAR_MIME_TYPES],
  };
  const { data: bucket } = await supabaseAdmin.storage.getBucket(AVATAR_BUCKET);
  if (!bucket) {
    const { error } = await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, options);
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
  } else if (!bucket.public) {
    const { error } = await supabaseAdmin.storage.updateBucket(AVATAR_BUCKET, options);
    if (error) throw new Error(error.message);
  }
  bucketReady = true;
}

/** Supprime les anciennes photos de l'utilisateur (sauf `keep`). Jamais bloquant. */
async function removeOldAvatars(userId: string, keep?: string) {
  try {
    const { data: files } = await supabaseAdmin.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 });
    const stale = (files ?? [])
      .map((f) => `${userId}/${f.name}`)
      .filter((path) => path !== keep);
    if (stale.length > 0) await supabaseAdmin.storage.from(AVATAR_BUCKET).remove(stale);
  } catch (err) {
    console.warn("[avatar] nettoyage des anciennes photos :", err instanceof Error ? err.message : err);
  }
}

/**
 * POST multipart/form-data { file } — envoie la photo de profil.
 * Le fichier est contrôlé CÔTÉ SERVEUR (taille, vrai type d'après sa signature),
 * déposé dans le bucket public « avatars » sous <id utilisateur>/<horodatage>.<ext>
 * (un nouveau nom à chaque envoi : jamais de problème de cache), puis l'URL est
 * enregistrée dans profiles.avatar_url. L'utilisateur est celui du jeton vérifié.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return fail("Non authentifié.", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Envoi invalide : aucun fichier reçu.", 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return fail("Aucune image reçue.", 400);

  if (file.size === 0) return fail("Le fichier est vide.", 400);
  if (file.size > AVATAR_MAX_BYTES) return fail(AVATAR_SIZE_ERROR, 413, "too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(bytes);
  if (!mime) return fail(AVATAR_FORMAT_ERROR, 415, "bad_format");

  // On lit le profil AVANT d'envoyer quoi que ce soit : si la colonne avatar_url
  // n'existe pas encore, on s'arrête proprement, sans fichier orphelin.
  const { data: profile, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (readError) {
    console.error("[avatar] lecture du profil :", readError.message);
    return fail(MIGRATION_HINT, 500, "not_configured");
  }
  if (!profile) return fail("Profil introuvable.", 404);

  try {
    await ensureAvatarBucket();
  } catch (err) {
    console.error("[avatar] bucket :", err instanceof Error ? err.message : err);
    return fail("Le stockage des photos est momentanément indisponible. Réessaie dans un instant.", 500, "storage_unavailable");
  }

  const path = `${userId}/${Date.now()}.${AVATAR_EXTENSIONS[mime]}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: mime, cacheControl: "31536000", upsert: false });
  if (uploadError) {
    console.error("[avatar] envoi :", uploadError.message);
    return fail("L'envoi de la photo a échoué. Réessaie dans un instant.", 500, "upload_failed");
  }

  const { data: pub } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);
  if (updateError) {
    console.error("[avatar] mise à jour du profil :", updateError.message);
    await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([path]); // pas de fichier orphelin
    return fail("La photo n'a pas pu être enregistrée sur ton profil. Réessaie.", 500, "profile_update_failed");
  }

  // Anciennes photos : supprimées seulement APRÈS que la nouvelle est bien enregistrée.
  await removeOldAvatars(userId, path);

  return NextResponse.json({ avatarUrl });
}

/** DELETE — retire la photo (retour à l'image par défaut). */
export async function DELETE(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return fail("Non authentifié.", 401);

  const { error } = await supabaseAdmin.from("profiles").update({ avatar_url: null }).eq("id", userId);
  if (error) {
    console.error("[avatar] suppression :", error.message);
    return fail("Impossible de retirer la photo pour le moment.", 500);
  }
  await removeOldAvatars(userId);
  return NextResponse.json({ avatarUrl: null });
}
