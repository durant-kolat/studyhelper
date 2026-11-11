"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import Header from "./Header";
import FloatingCalculator from "./FloatingCalculator";
import FloatingClock from "./FloatingClock";
import MobileNav from "./MobileNav";
import CelebrationBanner from "./CelebrationBanner";
import NotificationScheduler from "./NotificationScheduler";
import { supabase } from "@/lib/supabase";
import { AVATAR_CHANGED_EVENT } from "@/lib/avatar-client";

export default function AppShell({
  active,
  title,
  children,
}: {
  active: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [canModerate, setCanModerate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [xp, setXp] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // La photo change depuis la page profil : l'en-tête se met à jour sans rechargement.
  useEffect(() => {
    const onChange = (e: Event) => setAvatarUrl((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.push("/login");
        return;
      }

      // Pages admin/modération : si le compte a activé la 2FA mais que
      // la session actuelle n'a pas complété la vérification (AAL1 au
      // lieu d'AAL2), on renvoie se reconnecter avant même d'afficher
      // la page — la vraie protection reste côté serveur (fonction SQL
      // admin_update_user), ceci évite juste une redirection tardive
      // et confuse après une action refusée.
      if (active === "admin" || active === "moderation") {
        const { data: aal } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.currentLevel !== aal.nextLevel) {
          router.push("/login");
          return;
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, xp")
        .eq("id", data.session.user.id)
        .single();
      setCanModerate(profile?.role === "moderator" || profile?.role === "admin");
      setIsAdmin(profile?.role === "admin");
      setXp(profile?.xp ?? 0);
      setChecking(false);

      // Requête à part : si la colonne avatar_url n'existe pas encore (migration V1.9 non passée),
      // seule la photo manque — le reste de l'application n'est pas affecté.
      supabase
        .from("profiles")
        .select("avatar_url, full_name")
        .eq("id", data.session.user.id)
        .maybeSingle()
        .then(({ data: extra }) => {
          setAvatarUrl((extra?.avatar_url as string | null | undefined) ?? null);
          setUserName((extra?.full_name as string | null | undefined) ?? null);
        });
    });
  }, [router, active]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-slate">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar active={active} canModerate={canModerate} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={title}
          onLogout={handleLogout}
          onMenu={() => setMenuOpen(true)}
          xp={xp}
          avatarUrl={avatarUrl}
          userName={userName}
        />
        {/* pb-28 : réserve la place des outils flottants (calculatrice + horloge)
            pour qu'ils ne masquent jamais un bouton en bas de page. */}
        <main className="flex-1 px-6 py-6 pb-28 sm:px-8">
          <CelebrationBanner />
          {children}
        </main>
      </div>
      <MobileNav
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        active={active}
        canModerate={canModerate}
        isAdmin={isAdmin}
      />
      <FloatingClock />
      <FloatingCalculator />
      <NotificationScheduler />
    </div>
  );
}
