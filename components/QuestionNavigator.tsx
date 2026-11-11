"use client";

/** Grille de navigation pour les longs examens / quiz (jusqu'à 50 questions) : accès direct à une question, état « répondue ». */
export default function QuestionNavigator({ total, current, answers, onJump }: { total: number; current: number; answers: number[]; onJump: (index: number) => void }) {
  if (total <= 10) return null;
  const done = answers.filter((a) => a >= 0).length;
  return (
    <div className="mb-4 rounded-card border border-mist bg-white p-3">
      <p className="mb-2 text-xs text-slate">
        {done} / {total} répondues — touche un numéro pour y aller
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Navigation entre les questions">
        {Array.from({ length: total }, (_, i) => {
          const answered = answers[i] >= 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i)}
              aria-label={`Question ${i + 1}${answered ? " (répondue)" : ""}`}
              aria-current={i === current ? "true" : undefined}
              className={`h-8 w-8 rounded-card border text-xs ${
                i === current ? "border-ink bg-ink text-paper" : answered ? "border-forest/40 bg-forest/10 text-forest" : "border-mist text-slate hover:border-ink"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
