"use client";

import Link from "next/link";
import { Bell, LogOut, Menu } from "lucide-react";
import { levelFromXp } from "@/lib/badges";
import Avatar from "./Avatar";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function Header({
  title,
  onLogout,
  onMenu,
  xp = 0,
  avatarUrl = null,
  userName = null,
}: {
  title: string;
  onLogout?: () => void;
  onMenu?: () => void;
  xp?: number;
  avatarUrl?: string | null;
  userName?: string | null;
}) {
  const { t } = useI18n();
  return (
    <header className="flex items-center justify-between gap-2 border-b border-mist bg-paper px-4 py-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button
            type="button"
            aria-label={t("nav.openMenu")}
            onClick={onMenu}
            className="-ml-2 rounded-full p-2 text-ink hover:bg-mist2 sm:hidden"
          >
            <Menu size={22} />
          </button>
        )}
        <h1 className="truncate font-display text-xl text-ink">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
        <Link
          href="/badges"
          className="whitespace-nowrap rounded-full bg-gold/20 px-2.5 py-1 text-xs font-medium text-ink hover:bg-gold/30"
        >
          {t("common.level")} {levelFromXp(xp)}
        </Link>
        <button
          aria-label="Notifications"
          className="relative rounded-full p-2 text-slate hover:bg-mist2"
        >
          <Bell size={19} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-clay" />
        </button>
        <Link href="/profile" aria-label={t("nav.profile")} className="rounded-full">
          <Avatar src={avatarUrl} name={userName} size={32} />
        </Link>
        {onLogout && (
          <button
            aria-label={t("common.logout")}
            onClick={onLogout}
            className="rounded-full p-2 text-slate hover:bg-mist2"
          >
            <LogOut size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
