import { Bell, BookOpenCheck, FileClock, CheckCircle2 } from "lucide-react";

export type NotificationKind = "reminder" | "start" | "exam" | "done";

const icons: Record<NotificationKind, typeof Bell> = {
  reminder: Bell,
  start: BookOpenCheck,
  exam: FileClock,
  done: CheckCircle2,
};

export default function Notification({
  kind,
  message,
}: {
  kind: NotificationKind;
  message: string;
}) {
  const Icon = icons[kind];
  return (
    <div className="flex items-center gap-3 rounded-card border border-mist bg-white px-4 py-3">
      <Icon size={18} className="shrink-0 text-clay" />
      <p className="text-sm text-ink">{message}</p>
    </div>
  );
}
