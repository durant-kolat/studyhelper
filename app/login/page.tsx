"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n/I18nProvider";
import LanguageSelector from "@/components/LanguageSelector";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    // La connexion et l'anti-brute-force passent par une route serveur
    // (compteur d'échecs en base, pas juste en mémoire du navigateur —
    // un utilisateur ne peut plus le contourner en rechargeant la page).
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const result = await res.json();

    if (!res.ok) {
      setLoading(false);
      setError(result.error ?? t("auth.login.failed"));
      return;
    }

    // On établit la session côté client à partir des jetons renvoyés.
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
    if (sessionError) {
      setLoading(false);
      setError("Échec de l'établissement de la session.");
      return;
    }

    // Si le compte a activé la 2FA, Supabase exige un niveau
    // d'assurance supérieur (AAL2) avant d'accorder l'accès complet.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setLoading(false);

    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      setNeedsMfa(true);
      return;
    }

    router.push("/dashboard");
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (!factor) {
      setLoading(false);
      setError("Aucun facteur 2FA trouvé.");
      return;
    }

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError || !challenge) {
      setLoading(false);
      setError(challengeError?.message ?? "Échec du défi 2FA.");
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code: mfaCode,
    });

    setLoading(false);
    if (verifyError) {
      setError("Code incorrect, réessaie.");
      return;
    }

    router.push("/dashboard");
  }

  if (needsMfa) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="font-display text-lg text-ink">
            Study Helper
          </Link>
          <h1 className="mt-6 font-display text-2xl text-ink">
            {t("auth.mfa.title")}
          </h1>
          <p className="mt-1 text-sm text-slate">
            Entre le code à 6 chiffres de ton application d'authentification.
          </p>

          <form onSubmit={handleVerifyMfa} className="mt-8 space-y-4">
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              required
              className="w-full rounded-card border border-mist bg-white px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-ink"
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
              {loading ? t("common.loading") : t("auth.mfa.submit")}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-lg text-ink">
          Study Helper
        </Link>
        <h1 className="mt-6 font-display text-2xl text-ink">
          {t("auth.login.title")}
        </h1>
        <div className="mt-2">
          <LanguageSelector compact />
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate" htmlFor="email">
              {t("auth.login.email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="toi@exemple.com"
              className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm text-slate" htmlFor="password">
                {t("auth.login.password")}
              </label>
              <Link href="/forgot-password" className="text-xs text-clay hover:underline">
                {t("auth.login.forgot")}
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              placeholder="••••••••"
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
            {loading ? t("auth.login.loading") : t("auth.login.submit")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate">
          {t("auth.login.noAccount")}{" "}
          <Link href="/register" className="font-medium text-clay">
            {t("auth.register.title")}
          </Link>
        </p>
      </div>
    </main>
  );
}
