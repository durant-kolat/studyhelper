"use client";

import { useEffect } from "react";
import Link from "next/link";
import { GraduationCap, LayoutDashboard, Settings, ShieldCheck, X } from "lucide-react";
import { navItems } from "./Sidebar";
import { useI18n } from "@/lib/i18n/I18nProvider";

// Menu de navigation pour petits écrans : la barre latérale est masquée
// sous 640 px, sans ce menu il n'y avait aucun moyen d'atteindre
// l'Assistant, les Examens, etc. depuis un téléphone.

export default function MobileNav({
  open,
  onClose,
  active,
  canModerate = false,
  isAdmin = false,
}: {
  open: boolean;
  onClose: () => void;
  active: string;
  canModerate?: boolean;
  isAdmin?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-3 rounded-card px-3 py-3 text-sm transition-colors ${
      isActive ? "bg-white/10 text-paper" : "text-paper/70 hover:bg-white/5 hover:text-paper"
    }`;

  return (
    <div className="fixed inset-0 z-[60] sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label={t("nav.closeMenu")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/60"
      />
      <nav
        aria-label="Navigation principale"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-ink px-4 py-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-5 flex items-center justify-between px-2">
          <span className="flex items-center gap-2">
            <GraduationCap size={22} className="text-gold" />
            <span className="font-display text-lg text-paper">Study Helper</span>
          </span>
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={onClose}
            className="rounded-full p-2 text-paper/70 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          {navItems.map(({ key, href, labelKey, icon: Icon }) => (
            <Link key={key} href={href} onClick={onClose} className={linkClass(key === active)}>
              <Icon size={18} />
              {t(labelKey)}
            </Link>
          ))}

          {canModerate && (
            <Link href="/admin/moderation" onClick={onClose} className={`${linkClass(active === "moderation")} mt-2 border border-gold/30`}>
              <ShieldCheck size={18} />
              {t("nav.moderation")}
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" onClick={onClose} className={`${linkClass(active === "admin")} border border-gold/30`}>
              <LayoutDashboard size={18} />
              {t("nav.admin")}
            </Link>
          )}
        </div>

        <Link href="/profile" onClick={onClose} className={`${linkClass(active === "profile")} mt-3`}>
          <Settings size={18} />
          {t("nav.settings")}
        </Link>
      </nav>
    </div>
  );
}
