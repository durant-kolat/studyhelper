import jsPDF from "jspdf";
import type { CVData } from "./api";

// Couleurs de la marque Study Helper (voir tailwind.config.ts)
const INK: [number, number, number] = [27, 31, 59]; // #1B1F3B
const GOLD: [number, number, number] = [232, 163, 61]; // #E8A33D
const SLATE: [number, number, number] = [69, 74, 94]; // #454A5E
const PAPER: [number, number, number] = [251, 247, 240]; // #FBF7F0

export function downloadCVAsPdf(cv: CVData, filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const sidebarWidth = 170;

  // Bandeau latéral coloré (sidebar)
  doc.setFillColor(...INK);
  doc.rect(0, 0, sidebarWidth, pageHeight, "F");

  // --- Sidebar : nom, poste visé, compétences ---
  let sy = 60;
  doc.setTextColor(...PAPER);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  const nameLines = doc.splitTextToSize(cv.fullName, sidebarWidth - 40);
  doc.text(nameLines, 24, sy);
  sy += nameLines.length * 22 + 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...GOLD);
  const roleLines = doc.splitTextToSize(cv.targetRole, sidebarWidth - 40);
  doc.text(roleLines, 24, sy);
  sy += roleLines.length * 14 + 20;

  const contactLines = [cv.email, cv.phone, cv.location].filter(Boolean) as string[];
  if (contactLines.length) {
    doc.setDrawColor(...PAPER);
    doc.setLineWidth(0.5);
    doc.line(24, sy - 10, sidebarWidth - 24, sy - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PAPER);
    for (const line of contactLines) {
      const wrapped = doc.splitTextToSize(line, sidebarWidth - 40);
      doc.text(wrapped, 24, sy);
      sy += wrapped.length * 12 + 3;
    }
    sy += 14;
  }

  if (cv.skills?.length) {
    doc.setTextColor(...GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("COMPÉTENCES", 24, sy);
    sy += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...PAPER);
    for (const skill of cv.skills) {
      const lines = doc.splitTextToSize(`•  ${skill}`, sidebarWidth - 40);
      doc.text(lines, 24, sy);
      sy += lines.length * 13 + 4;
    }
  }

  // --- Colonne principale : accroche, formation, expérience ---
  const mainX = sidebarWidth + 32;
  const maxWidth = pageWidth - mainX - 32;
  let y = 60;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  const taglineLines = doc.splitTextToSize(cv.tagline, maxWidth);
  doc.text(taglineLines, mainX, y);
  y += taglineLines.length * 15 + 26;

  function section(title: string, entries: { period: string; title: string; detail: string }[]) {
    if (!entries?.length) return;
    if (y > pageHeight - 100) {
      doc.addPage();
      y = 60;
    }
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(title.toUpperCase(), mainX, y);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(2);
    doc.line(mainX, y + 4, mainX + 30, y + 4);
    y += 22;

    for (const entry of entries) {
      if (y > pageHeight - 60) {
        doc.addPage();
        y = 60;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      doc.text(entry.title, mainX, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...GOLD);
      const periodWidth = doc.getTextWidth(entry.period);
      doc.text(entry.period, mainX + maxWidth - periodWidth, y);
      y += 15;

      if (entry.detail) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...SLATE);
        const detailLines = doc.splitTextToSize(entry.detail, maxWidth);
        doc.text(detailLines, mainX, y);
        y += detailLines.length * 13 + 4;
      }
      y += 10;
    }
    y += 8;
  }

  section("Expérience", cv.experience);
  section("Formation", cv.education);

  doc.save(filename);
}
