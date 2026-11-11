// Photo de profil — constantes et contrôles PARTAGÉS (navigateur + serveur).
// Aucun secret, aucune dépendance.

export const AVATAR_BUCKET = "avatars";

/** 2 Mo : taille maximale d'une photo de profil. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarMime = (typeof AVATAR_MIME_TYPES)[number];

/** Valeur de l'attribut `accept` du champ fichier (JPG, JPEG, PNG, WebP). */
export const AVATAR_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export const AVATAR_EXTENSIONS: Record<AvatarMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const AVATAR_FORMAT_ERROR = "Format non accepté : choisis une image JPG, JPEG, PNG ou WebP.";
export const AVATAR_SIZE_ERROR = "Image trop lourde : 2 Mo maximum.";

/**
 * Type RÉEL de l'image d'après ses premiers octets (signature du fichier) — on ne se
 * fie jamais au type ou à l'extension annoncés par le navigateur, qui se falsifient.
 */
export function detectImageMime(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP : « RIFF » + taille (4 octets) + « WEBP »
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Chemin de stockage d'un fichier d'après son URL publique
 * (…/storage/v1/object/public/avatars/<chemin>) — null si l'URL n'est pas la nôtre.
 */
export function avatarPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  return path || null;
}
