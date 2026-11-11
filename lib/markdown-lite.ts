// Mise en forme minimale des réponses de l'assistant : paragraphes, listes,
// titres, blocs de code, **gras** et `code`. Volontairement limité et sans
// HTML brut : le texte est rendu par React (jamais dangerouslySetInnerHTML),
// donc une réponse ne peut pas injecter de balise ou de script.

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string };

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const H = /^\s{0,3}#{1,6}\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isSpecial = (line: string) =>
    line.trim().startsWith("```") || UL.test(line) || OL.test(line) || H.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // ferme le bloc (ou fin du texte si non fermé)
      blocks.push({ type: "code", lang, text: code.join("\n") });
      continue;
    }

    const heading = H.exec(line);
    if (heading) {
      blocks.push({ type: "h", text: heading[1].trim() });
      i++;
      continue;
    }

    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL.test(lines[i])) {
        items.push((UL.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL.test(lines[i])) {
        items.push((OL.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

export type Inline = { type: "text" | "bold" | "code"; text: string };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith("**")) out.push({ type: "bold", text: token.slice(2, -2) });
    else out.push({ type: "code", text: token.slice(1, -1) });
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
