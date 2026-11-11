import { FileText } from "lucide-react";

export type Course = {
  title: string;
  subject: string;
  updatedLabel: string;
};

export default function CourseCard({ course }: { course: Course }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-mist bg-white p-4 hover:border-ink">
      <div className="rounded-card bg-gold/15 p-2 text-clay">
        <FileText size={18} />
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{course.title}</p>
        <p className="text-xs text-slate">{course.subject}</p>
        <p className="mt-2 text-xs text-slate/70">
          importé {course.updatedLabel}
        </p>
      </div>
    </div>
  );
}
