"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password` }
    );

    setLoading(false);

    // Message volontairement identique que l'email existe ou non — ne
    // jamais révéler si une adresse est enregistrée (fuite d'info).
    if (resetError && resetError.status && resetError.status >= 500) {
      setError("Une erreur est survenue, réessaie dans un instant.");
      return;
    }
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-lg text-ink">
          Study Helper
        </Link>
        <h1 className="mt-6 font-display text-2xl text-ink">
          Mot de passe oublié
        </h1>

        {sent ? (
          <>
            <p className="mt-4 text-sm text-slate">
              Si un compte existe avec cette adresse, un e-mail vient de
              t'être envoyé avec un lien pour choisir un nouveau mot de
              passe. Vérifie aussi tes spams.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-card border border-mist px-5 py-2.5 text-sm text-ink hover:border-ink"
            >
              Retour à la connexion
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate">
              Entre ton adresse e-mail, on t'envoie un lien pour le
              réinitialiser.
            </p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="toi@exemple.com"
                className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              />
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
                {loading ? "Envoi…" : "Envoyer le lien"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-slate">
              <Link href="/login" className="font-medium text-clay">
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
