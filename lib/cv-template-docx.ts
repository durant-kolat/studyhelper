import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  ShadingType,
  BorderStyle,
} from "docx";
import type { CVData, CVEntry } from "./api";

const INK = "1B1F3B";
const GOLD = "E8A33D";
const SLATE = "454A5E";
const PAPER = "FBF7F0";

function entryParagraphs(entries: CVEntry[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const e of entries) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: e.title, bold: true, color: INK }),
          new TextRun({ text: `   ${e.period}`, color: GOLD, size: 18 }),
        ],
        spacing: { before: 160 },
      })
    );
    if (e.detail) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: e.detail, color: SLATE, size: 20 })],
        })
      );
    }
  }
  return out;
}

export async function downloadCVAsDocx(cv: CVData, filename: string) {
  const sidebar = new TableCell({
    width: { size: 30, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: INK, fill: INK },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 300, bottom: 300, left: 200, right: 200 },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
    },
    children: [
      new Paragraph({
        children: [new TextRun({ text: cv.fullName, bold: true, color: PAPER, size: 28 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: cv.targetRole, color: GOLD, size: 20 })],
        spacing: { after: [cv.email, cv.phone, cv.location].some(Boolean) ? 200 : 300 },
      }),
      ...([cv.email, cv.phone, cv.location].filter(Boolean) as string[]).map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, color: PAPER, size: 18 })],
            spacing: { after: 60 },
          })
      ),
      ...([cv.email, cv.phone, cv.location].some(Boolean)
        ? [new Paragraph({ children: [], spacing: { after: 200 } })]
        : []),
      ...(cv.skills?.length
        ? [
            new Paragraph({
              children: [new TextRun({ text: "COMPÉTENCES", bold: true, color: GOLD, size: 18 })],
              spacing: { after: 120 },
            }),
            ...cv.skills.map(
              (s) =>
                new Paragraph({
                  children: [new TextRun({ text: `•  ${s}`, color: PAPER, size: 19 })],
                  spacing: { after: 60 },
                })
            ),
          ]
        : []),
    ],
  });

  const main = new TableCell({
    width: { size: 70, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 300, bottom: 300, left: 300, right: 200 },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
    },
    children: [
      new Paragraph({
        children: [new TextRun({ text: cv.tagline, italics: true, color: INK, size: 21 })],
        spacing: { after: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: "EXPÉRIENCE", bold: true, color: INK, size: 24 })],
        spacing: { after: 120 },
      }),
      ...entryParagraphs(cv.experience ?? []),
      new Paragraph({
        children: [new TextRun({ text: "FORMATION", bold: true, color: INK, size: 24 })],
        spacing: { before: 300, after: 120 },
      }),
      ...entryParagraphs(cv.education ?? []),
    ],
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [sidebar, main] })],
  });

  const doc = new Document({
    sections: [{ properties: {}, children: [table] }],
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
