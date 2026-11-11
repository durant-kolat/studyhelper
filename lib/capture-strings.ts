// Textes de la caméra / de l'import (Mes cours + Pratique). Français et anglais ; les autres langues retombent sur l'anglais.
import { type LangCode } from "./i18n/languages";

const KEYS = [
  "import", "camera", "importDoc", "importImage", "cameraTitle", "capture", "finish", "cancel", "retake", "pages",
  "denied", "unsupported", "ocrRunning", "building", "hint", "removeImage", "askAboutImage", "imageSent",
] as const;
export type CaptureKey = (typeof KEYS)[number];

const S: Record<"fr" | "en", Record<CaptureKey, string>> = {
  fr: {
    import: "Importer",
    camera: "Caméra",
    importDoc: "Importer un document",
    importImage: "Importer une image",
    cameraTitle: "Filmer le cours",
    capture: "Prendre la page",
    finish: "Terminer",
    cancel: "Annuler",
    retake: "Supprimer la dernière",
    pages: "{n} page(s)",
    denied: "Accès à la caméra refusé. Autorise-la dans ton navigateur, ou utilise « Importer ».",
    unsupported: "Caméra indisponible sur cet appareil. Utilise « Importer ».",
    ocrRunning: "Lecture du texte des pages…",
    building: "Création du document…",
    hint: "Cadre une page à la fois, bien à plat et bien éclairée, puis appuie sur le bouton rond.",
    removeImage: "Retirer l'image",
    askAboutImage: "Pose ta question sur cette image (facultatif)…",
    imageSent: "📷 Image envoyée",
  },
  en: {
    import: "Import",
    camera: "Camera",
    importDoc: "Import a document",
    importImage: "Import an image",
    cameraTitle: "Film the course",
    capture: "Capture page",
    finish: "Done",
    cancel: "Cancel",
    retake: "Delete last",
    pages: "{n} page(s)",
    denied: "Camera access denied. Allow it in your browser, or use “Import”.",
    unsupported: "Camera not available on this device. Use “Import”.",
    ocrRunning: "Reading the text on the pages…",
    building: "Creating the document…",
    hint: "Frame one page at a time, flat and well lit, then press the round button.",
    removeImage: "Remove image",
    askAboutImage: "Ask a question about this image (optional)…",
    imageSent: "📷 Image sent",
  },
};

export function captureText(lang: LangCode, key: CaptureKey, vars?: Record<string, string | number>): string {
  const dict = lang === "fr" ? S.fr : S.en;
  const raw = dict[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
