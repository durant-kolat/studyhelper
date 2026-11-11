// Extraction du texte d'un document de la bibliothèque (PDF, .txt, image par OCR, .docx, .pptx), SANS appel Gemini.
// Même logique que /api/analyze (laissée telle quelle : copie volontaire pour ne pas toucher à l'analyse existante).
// SERVEUR UNIQUEMENT : télécharge dans le bucket privé avec la clé service_role.
import { supabaseAdmin } from "@/lib/supabase-admin";

const OCR_TIMEOUT_MS = 45_000;
const MAX_EXTRACTED_CHARS = 200_000; // garde-fou mémoire, bien au-delà d'un vrai cours

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} a dépassé ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function extractText(filePath: string): Promise<string | null> {
  // Bucket privé : on télécharge avec la clé service_role, qui a accès
  // à tout le bucket indépendamment des policies RLS de stockage —
  // jamais via une URL publique.
  const { data: blob, error } = await supabaseAdmin.storage
    .from("documents")
    .download(filePath);
  if (error || !blob) return null;

  const buffer = Buffer.from(await blob.arrayBuffer());
  const lowerPath = filePath.toLowerCase();
  let text: string | null = null;

  if (lowerPath.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    text = parsed.text;
  } else if (lowerPath.endsWith(".txt")) {
    text = buffer.toString("utf-8");
  } else if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lowerPath)) {
    // OCR gratuit (Tesseract.js) pour les photos de notes — français +
    // anglais, avec un timeout : une image très complexe ou corrompue
    // ne doit jamais bloquer la route indéfiniment.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["fra", "eng"]);
    try {
      const {
        data: { text: ocrText },
      } = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS, "L'OCR");
      text = ocrText;
    } finally {
      await worker.terminate();
    }
  } else if (lowerPath.endsWith(".docx")) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer });
    text = value;
  } else if (lowerPath.endsWith(".pptx")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
        return na - nb;
      });

    const slideTexts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name].async("text");
      // Le texte visible d'une diapo est dans des balises <a:t>...</a:t>.
      const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)];
      slideTexts.push(matches.map((m) => m[1]).join(" "));
    }
    text = slideTexts.join("\n\n");
  }
  // Anciens formats binaires .doc / .ppt (pré-2007) : non pris en
  // charge — seuls les formats modernes .docx / .pptx le sont.

  return text ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
}
