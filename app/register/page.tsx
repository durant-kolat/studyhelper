"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const types = [
  { label: "Élève (primaire)", value: "eleve_primaire" },
  { label: "Élève (secondaire)", value: "eleve_secondaire" },
  { label: "Étudiant universitaire", value: "etudiant" },
  { label: "Formation professionnelle", value: "formation_pro" },
  { label: "Enseignant / Formateur", value: "enseignant" },
  { label: "Entreprise", value: "entreprise" },
];

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("name"));
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const accountType = String(form.get("accountType"));

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, account_type: accountType },
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // Si la confirmation par e-mail est activée sur le projet Supabase,
    // l'inscription réussit mais ne crée PAS de session tout de suite —
    // rediriger vers le tableau de bord donnerait une app cassée (aucun
    // jeton disponible, tout échouerait en "Non authentifié"). On informe
    // clairement au lieu de rediriger dans le vide.
    if (!data.session) {
      setNeedsEmailConfirmation(true);
      return;
    }

    router.push("/dashboard");
  }

  if (needsEmailConfirmation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <Link href="/" className="font-display text-lg text-ink">
            Study Helper
          </Link>
          <h1 className="mt-6 font-display text-2xl text-ink">
            Vérifie ta boîte mail
          </h1>
          <p className="mt-3 text-sm text-slate">
            Ton compte est créé. Clique sur le lien de confirmation qu'on
            vient de t'envoyer par e-mail pour activer ton espace, puis
            connecte-toi.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/90"
          >
            Aller à la connexion
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-lg text-ink">
          Study Helper
        </Link>
        <h1 className="mt-6 font-display text-2xl text-ink">
          Crée ton espace
        </h1>
        <p className="mt-1 text-sm text-slate">
          Quelques informations, et ton planning t'attend.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate" htmlFor="name">
              Nom complet
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate" htmlFor="email">
              Adresse e-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm text-slate"
              htmlFor="password"
            >
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm text-slate">Tu es</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {types.map((t, i) => (
                <label
                  key={t.value}
                  className="flex cursor-pointer items-center gap-2 rounded-card border border-mist px-3 py-2 text-sm text-ink hover:border-ink has-[:checked]:border-clay has-[:checked]:bg-clay/5"
                >
                  <input
                    type="radio"
                    name="accountType"
                    value={t.value}
                    defaultChecked={i === 0}
                    className="accent-clay"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-card bg-clay py-2.5 text-sm font-medium text-paper hover:bg-clay/90 disabled:opacity-60"
          >
            {loading ? "Création en cours…" : "Créer mon compte"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium text-clay">
            Connecte-toi
          </Link>
        </p>
      </div>
    </main>
  );
}
