import jsPDF from "jspdf";

/**
 * Convertit un texte (Markdown simple — titres avec #, listes avec -/*)
 * en PDF téléchargeable, directement dans le navigateur. Suffisant pour
 * du texte de CV/lettre ; pas une vraie mise en page Word/PDF avancée.
 */
export function downloadTextAsPdf(text: string, filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 56;

  const lines = text.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (y > pageHeight - 56) {
      doc.addPage();
      y = 56;
    }

    if (line.startsWith("# ")) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      const wrapped = doc.splitTextToSize(line.slice(2), maxWidth);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 20 + 6;
    } else if (line.startsWith("## ")) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const wrapped = doc.splitTextToSize(line.slice(3), maxWidth);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 17 + 4;
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const wrapped = doc.splitTextToSize(`•  ${line.slice(2)}`, maxWidth - 10);
      doc.text(wrapped, marginX + 10, y);
      y += wrapped.length * 14 + 2;
    } else if (line.trim() === "") {
      y += 10;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const wrapped = doc.splitTextToSize(line, maxWidth);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 14 + 2;
    }
  }

  doc.save(filename);
}
