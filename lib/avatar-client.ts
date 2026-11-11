// Préparation de la photo de profil DANS LE NAVIGATEUR : contrôle du format, puis
// réduction/recadrage carré (512 px, JPEG) avant l'envoi. Une photo d'appareil fait
// souvent 3 à 8 Mo : sans cette réduction, la limite de 2 Mo la refuserait presque
// toujours. Le serveur re-contrôle tout de toute façon (route /api/profile/avatar).

import {
  AVATAR_FORMAT_ERROR,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_SIZE_ERROR,
} from "./avatar";

export class AvatarError extends Error {}

const OUTPUT_SIZE = 512;
/** Photo brute acceptée avant réduction (l'image envoyée, elle, fait moins de 2 Mo). */
const SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/** Vérifie le fichier choisi et renvoie l'image à envoyer (≤ 2 Mo, carrée, JPEG). */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const typeOk = (AVATAR_MIME_TYPES as readonly string[]).includes(file.type);
  // Certains téléphones n'indiquent aucun type : l'extension sert alors de repère.
  if ((file.type && !typeOk) || (!file.type && !ALLOWED_EXTENSIONS.includes(ext))) {
    throw new AvatarError(AVATAR_FORMAT_ERROR);
  }
  if (file.size === 0) throw new AvatarError("Le fichier est vide.");
  if (file.size > SOURCE_MAX_BYTES) {
    throw new AvatarError("Image beaucoup trop lourde : choisis une photo de moins de 15 Mo.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    let width = 0;
    let height = 0;
    let source: CanvasImageSource;
    try {
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } else {
        throw new Error("no-bitmap");
      }
    } catch {
      try {
        const img = await loadImage(objectUrl);
        source = img;
        width = img.naturalWidth;
        height = img.naturalHeight;
      } catch {
        throw new AvatarError("Cette image est illisible ou corrompue. Essaie une autre photo.");
      }
    }
    if (!width || !height) throw new AvatarError("Cette image est illisible ou corrompue. Essaie une autre photo.");

    // Recadrage carré centré, puis réduction ; on baisse qualité/taille si > 2 Mo.
    const side = Math.min(width, height);
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;
    for (const [size, quality] of [
      [Math.min(OUTPUT_SIZE, side), 0.88],
      [Math.min(384, side), 0.75],
      [Math.min(256, side), 0.65],
    ] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#ffffff"; // fond blanc : une PNG transparente ne devient pas noire en JPEG
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size > 0 && blob.size <= AVATAR_MAX_BYTES) return blob;
    }

    // Repli (canvas indisponible) : le fichier d'origine, s'il respecte déjà la limite.
    if (file.size <= AVATAR_MAX_BYTES && typeOk) return file;
    throw new AvatarError(AVATAR_SIZE_ERROR);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Événement navigateur : la photo vient de changer (l'en-tête se met à jour aussitôt). */
export const AVATAR_CHANGED_EVENT = "studyhelper:avatar-changed";

export function announceAvatarChanged(url: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string | null>(AVATAR_CHANGED_EVENT, { detail: url }));
}
