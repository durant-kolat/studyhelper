import { Fragment } from "react";
import { parseBlocks, parseInline } from "@/lib/markdown-lite";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.type === "bold") return <strong key={i}>{part.text}</strong>;
        if (part.type === "code") {
          return (
            <code key={i} className="rounded bg-ink/10 px-1 py-0.5 font-mono text-[0.85em]">
              {part.text}
            </code>
          );
        }
        return <Fragment key={i}>{part.text}</Fragment>;
      })}
    </>
  );
}

/** Affiche une réponse de l'assistant (texte + mise en forme légère, sans HTML brut). */
export default function MessageContent({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h":
            return (
              <p key={i} className="font-display text-base font-semibold">
                <Inline text={block.text} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-card bg-ink px-3 py-2 font-mono text-xs leading-relaxed text-paper"
              >
                <code>{block.text}</code>
              </pre>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
