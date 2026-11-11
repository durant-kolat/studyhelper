"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Le lien reçu par e-mail établit automatiquement une session de
    // type "recovery" côté Supabase (via le fragment d'URL). On attend
    // juste qu'elle soit prête avant d'autoriser le formulaire.
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-lg text-ink">
          Study Helper
        </Link>
        <h1 className="mt-6 font-display text-2xl text-ink">
          Nouveau mot de passe
        </h1>

        {done ? (
          <p className="mt-4 text-sm text-forest">
            Mot de passe mis à jour — redirection vers la connexion…
          </p>
        ) : !ready ? (
          <p className="mt-4 text-sm text-slate">
            Vérification du lien…{" "}
            <Link href="/forgot-password" className="text-clay underline">
              Redemander un lien
            </Link>{" "}
            s'il a expiré.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">
                Confirme le mot de passe
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              />
            </div>
            {error && (
              <p className="rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-card bg-ink py-2.5 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-60"
            >
              {loading ? "Mise à jour…" : "Changer le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
