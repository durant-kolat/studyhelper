import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from "docx";

/**
 * Convertit un texte (Markdown simple — titres avec #, listes avec -/*)
 * en document Word (.docx) téléchargeable, directement dans le
 * navigateur. Même limite que l'export PDF : mise en page simple, pas
 * un vrai template graphique.
 */
export async function downloadTextAsDocx(text: string, filename: string) {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 })
      );
    } else if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 })
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      paragraphs.push(
        new Paragraph({ text: line.slice(2), bullet: { level: 0 } })
      );
    } else if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "" }));
    } else {
      paragraphs.push(
        new Paragraph({ children: [new TextRun(line)] })
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
