export type SubjectProgress = {
  subject: string;
  percent: number;
};

function colorFor(percent: number) {
  if (percent >= 80) return "bg-forest";
  if (percent >= 60) return "bg-gold";
  return "bg-clay";
}

export default function ProgressCard({ data }: { data: SubjectProgress[] }) {
  return (
    <div className="rounded-card border border-mist bg-white p-5">
      <p className="mb-4 font-display text-base text-ink">Par matière</p>
      <div className="space-y-4">
        {data.map((d) => (
          <div key={d.subject}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-ink">{d.subject}</span>
              <span className="text-slate">{d.percent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-mist2">
              <div
                className={`h-2 rounded-full ${colorFor(d.percent)}`}
                style={{ width: `${d.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
