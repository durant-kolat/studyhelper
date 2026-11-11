"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { DictKey } from "@/lib/i18n/dictionaries";
import {
  Dumbbell,
  Home,
  BookOpen,
  FileClock,
  Trophy,
  CalendarDays,
  LineChart,
  Users,
  Bot,
  Library,
  Calculator,
  Settings,
  GraduationCap,
  Briefcase,
  PartyPopper,
  ShieldCheck,
  LayoutDashboard,
  BadgeCheck,
  Award,
  Store,
} from "lucide-react";

export const navItems: { key: string; href: string; label: string; labelKey: DictKey; icon: typeof Home }[] = [
  { key: "dashboard", href: "/dashboard", label: "Accueil", labelKey: "nav.dashboard" as DictKey, icon: Home },
  { key: "courses", href: "/courses", label: "Mes cours", labelKey: "nav.courses" as DictKey, icon: BookOpen },
  { key: "exams", href: "/exams", label: "Examens", labelKey: "nav.exams" as DictKey, icon: FileClock },
  { key: "quizzes", href: "/quizzes", label: "Quiz", labelKey: "nav.quizzes" as DictKey, icon: Trophy },
  {
    key: "schedule",
    href: "/schedule",
    label: "Planning", labelKey: "nav.schedule" as DictKey,
    icon: CalendarDays,
  },
  {
    key: "progress",
    href: "/progress",
    label: "Progression", labelKey: "nav.progress" as DictKey,
    icon: LineChart,
  },
  { key: "groups", href: "/groups", label: "Groupes", labelKey: "nav.groups" as DictKey, icon: Users },
  {
    key: "opportunities",
    href: "/opportunities",
    label: "Opportunités", labelKey: "nav.opportunities" as DictKey,
    icon: Briefcase,
  },
  {
    key: "activities",
    href: "/activities",
    label: "Activités", labelKey: "nav.activities" as DictKey,
    icon: PartyPopper,
  },
  { key: "assistant", href: "/assistant", label: "Assistant", labelKey: "nav.assistant" as DictKey, icon: Bot },
  { key: "practice", href: "/practice", label: "Pratique", labelKey: "nav.practice" as DictKey, icon: Dumbbell },
  { key: "career", href: "/career", label: "Espace Carrière", labelKey: "nav.career" as DictKey, icon: BadgeCheck },
  { key: "marketplace", href: "/marketplace", label: "Marketplace", labelKey: "nav.marketplace" as DictKey, icon: Store },
  { key: "badges", href: "/badges", label: "Progression & Badges", labelKey: "nav.badges" as DictKey, icon: Award },
  { key: "library", href: "/library", label: "Bibliothèque", labelKey: "nav.library" as DictKey, icon: Library },
  { key: "tools", href: "#outils", label: "Outils", labelKey: "nav.tools" as DictKey, icon: Calculator },
];

export default function Sidebar({
  active,
  canModerate = false,
  isAdmin = false,
}: {
  active: string;
  canModerate?: boolean;
  isAdmin?: boolean;
}) {
  const { t } = useI18n();
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-ink px-4 py-6 sm:flex">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2">
        <GraduationCap size={22} className="text-gold" />
        <span className="font-display text-lg text-paper">
          Study Helper
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map(({ key, href, labelKey, icon: Icon }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={href}
              className={`flex items-center gap-3 rounded-card px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-white/10 text-paper"
                  : "text-paper/60 hover:bg-white/5 hover:text-paper"
              }`}
            >
              <Icon size={17} />
              {t(labelKey)}
            </Link>
          );
        })}

        {canModerate && (
          <Link
            href="/admin/moderation"
            className={`mt-2 flex items-center gap-3 rounded-card border border-gold/30 px-3 py-2 text-sm transition-colors ${
              active === "moderation"
                ? "bg-gold/20 text-gold"
                : "text-gold/80 hover:bg-gold/10"
            }`}
          >
            <ShieldCheck size={17} />
            {t("nav.moderation")}
          </Link>
        )}
        {isAdmin && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 rounded-card border border-gold/30 px-3 py-2 text-sm transition-colors ${
              active === "admin"
                ? "bg-gold/20 text-gold"
                : "text-gold/80 hover:bg-gold/10"
            }`}
          >
            <LayoutDashboard size={17} />
            {t("nav.admin")}
          </Link>
        )}
      </nav>

      <Link
        href="/profile"
        className={`flex items-center gap-3 rounded-card px-3 py-2 text-sm transition-colors ${
          active === "profile"
            ? "bg-white/10 text-paper"
            : "text-paper/60 hover:bg-white/5 hover:text-paper"
        }`}
      >
        <Settings size={17} />
        {t("nav.settings")}
      </Link>
    </aside>
  );
}
