// Outils navigateur pour la caméra : réduction d'image, assemblage en PDF, lecture du texte (OCR gratuit).
"use client";

const MAX_SIDE = 1600;

/** Réduit une image (côté max 1600 px) en JPEG : léger à envoyer, sous la limite du serveur. */
export async function toJpeg(source: Blob, maxSide = MAX_SIDE, quality = 0.85): Promise<{ blob: Blob; dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", quality)
  );
  return { blob, dataUrl, width: canvas.width, height: canvas.height };
}

/** Assemble plusieurs photos en un seul PDF (une page par photo, à la taille de l'image). */
export async function imagesToPdf(pages: { dataUrl: string; width: number; height: number }[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const p of pages) {
    const orientation = p.width >= p.height ? "l" : "p";
    if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [p.width, p.height], compress: true });
    else pdf.addPage([p.width, p.height], orientation);
    pdf.addImage(p.dataUrl, "JPEG", 0, 0, p.width, p.height, undefined, "FAST");
  }
  if (!pdf) throw new Error("no pages");
  return pdf.output("blob");
}

/** Lit le texte des photos dans le navigateur (Tesseract.js, gratuit). Renvoie "" si la lecture échoue. */
export async function ocrImages(blobs: Blob[], onProgress?: (done: number, total: number) => void): Promise<string> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["fra", "eng"]);
    try {
      const parts: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        const { data } = await worker.recognize(blobs[i]);
        parts.push(data.text.trim());
        onProgress?.(i + 1, blobs.length);
      }
      return parts.filter(Boolean).join("\n\n");
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    console.error("[capture] OCR impossible :", e instanceof Error ? e.message : e);
    return "";
  }
}
