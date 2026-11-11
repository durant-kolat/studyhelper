// Déclaration minimale de pdf.js (build navigateur) : seul ce que FullscreenViewer utilise.
declare module "pdfjs-dist/build/pdf" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: { url: string }): { promise: Promise<unknown> };
}
