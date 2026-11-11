"use client";

import LanguageSelector from "@/components/LanguageSelector";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import AvatarUploader from "@/components/AvatarUploader";
import PremiumStatusCard from "@/components/PremiumStatusCard";
import LearnerMemoryCard from "@/components/LearnerMemoryCard";
import PaymentHistory from "@/components/PaymentHistory";
import CelebrationSettings from "@/components/CelebrationSettings";
import { Loader2, ShieldCheck, ShieldOff, Smartphone, Bell, BellOff, Globe } from "lucide-react";
import {
  getPushSubscriptionStatus,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";
import { announceTimezoneChanged } from "@/lib/floating-tools";

const accountTypeLabels: Record<string, string> = {
  eleve_primaire: "Élève (primaire)",
  eleve_secondaire: "Élève (secondaire)",
  etudiant: "Étudiant universitaire",
  formation_pro: "Formation professionnelle",
  enseignant: "Enseignant / Formateur",
  entreprise: "Entreprise",
};

type Profile = {
  full_name: string;
  account_type: string;
  avatar_url: string | null;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    // La colonne avatar_url vient de la migration V1.9 : si elle manque encore, on relit sans
    // elle plutôt que de bloquer toute la page. (L'abonnement Premium est chargé par
    // PremiumStatusCard depuis le serveur : /api/premium/status.)
    const full = await supabase
      .from("profiles")
      .select("full_name, account_type, avatar_url")
      .eq("id", userData.user.id)
      .single();
    if (!full.error && full.data) {
      setProfile(full.data as Profile);
    } else {
      const basic = await supabase
        .from("profiles")
        .select("full_name, account_type")
        .eq("id", userData.user.id)
        .single();
      if (basic.data) setProfile({ ...(basic.data as Profile), avatar_url: null });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading || !profile) {
    return (
      <AppShell active="profile" title="Profil">
        <p className="text-sm text-slate">Chargement…</p>
      </AppShell>
    );
  }

  return (
    <AppShell active="profile" title="Profil">
      <div className="max-w-lg rounded-card border border-mist bg-white p-6">
        <div className="mb-6 flex items-center gap-4">
          <AvatarUploader
            avatarUrl={profile.avatar_url}
            name={profile.full_name}
            onChange={(url) => setProfile((p) => (p ? { ...p, avatar_url: url } : p))}
          />
        </div>
        <div className="mb-6 -mt-2">
          <p className="font-display text-lg text-ink">{profile.full_name}</p>
          <p className="text-sm text-slate">
            {accountTypeLabels[profile.account_type] ?? profile.account_type}
          </p>
        </div>

        <PremiumStatusCard accountType={profile.account_type} />
        <PaymentHistory />
      </div>

      <LearnerMemoryCard />
      <CelebrationSettings />
      <SecuritySection />
      <NotificationsSection />
      <LanguageSelector />
      <TimezoneSection />
    </AppShell>
  );
}

function SecuritySection() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    setEnrolled(!!totp);
    setFactorId(totp?.id ?? null);
  }

  useEffect(() => {
    loadFactors();
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Échec de l'activation.");
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setEnrolling(true);
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setBusy(false);
      setError(challengeError?.message ?? "Échec du défi.");
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    setBusy(false);
    if (verifyError) {
      setError("Code incorrect, réessaie.");
      return;
    }

    setEnrolling(false);
    setQrCode(null);
    setCode("");
    await loadFactors();
  }

  async function handleUnenroll() {
    if (!factorId) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    await loadFactors();
  }

  return (
    <div className="mt-6 max-w-lg rounded-card border border-mist bg-white p-6">
      <div className="flex items-center gap-2">
        {enrolled ? (
          <ShieldCheck size={16} className="text-forest" />
        ) : (
          <ShieldOff size={16} className="text-slate" />
        )}
        <p className="font-display text-sm text-ink">
          Double authentification (2FA)
        </p>
      </div>

      {enrolled === null ? null : enrolled ? (
        <>
          <p className="mt-2 text-sm text-slate">
            Activée — un code de ton application d'authentification est
            demandé à chaque connexion.
          </p>
          <button
            onClick={handleUnenroll}
            disabled={busy}
            className="mt-3 rounded-card border border-clay px-4 py-2 text-sm text-clay hover:bg-clay/5 disabled:opacity-60"
          >
            Désactiver la 2FA
          </button>
        </>
      ) : enrolling && qrCode ? (
        <form onSubmit={confirmEnroll} className="mt-3 space-y-3">
          <p className="text-sm text-slate">
            Scanne ce code avec Google Authenticator, Authy ou une app
            équivalente, puis entre le code à 6 chiffres généré.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="QR code 2FA" className="h-40 w-40" />
          {secret && (
            <p className="break-all rounded-card bg-mist2 px-3 py-2 text-xs text-slate">
              Ou saisis manuellement : {secret}
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            required
            className="w-full rounded-card border border-mist px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-ink"
          />
          {error && <p className="text-sm text-clay">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            {busy ? "Vérification…" : "Confirmer l'activation"}
          </button>
        </form>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate">
            Recommandée pour les comptes Modérateur et Admin — protège ton
            compte même si ton mot de passe fuite.
          </p>
          <button
            onClick={startEnroll}
            disabled={busy}
            className="mt-3 flex items-center gap-2 rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            <Smartphone size={15} />
            {busy ? "Préparation…" : "Activer la 2FA"}
          </button>
          {error && <p className="mt-2 text-sm text-clay">{error}</p>}
        </>
      )}
    </div>
  );
}

function NotificationsSection() {
  const [status, setStatus] = useState<
    "checking" | "unsupported" | "not-subscribed" | "subscribed"
  >("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushSubscriptionStatus().then(setStatus);
  }, []);

  async function handleSubscribe() {
    setBusy(true);
    setError(null);
    const result = await subscribeToPush();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus("subscribed");
  }

  async function handleUnsubscribe() {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    setStatus("not-subscribed");
  }

  if (status === "checking") return null;

  return (
    <div className="mt-6 max-w-lg rounded-card border border-mist bg-white p-6">
      <div className="flex items-center gap-2">
        {status === "subscribed" ? (
          <Bell size={16} className="text-forest" />
        ) : (
          <BellOff size={16} className="text-slate" />
        )}
        <p className="font-display text-sm text-ink">
          Notifications push
        </p>
      </div>

      {status === "unsupported" ? (
        <p className="mt-2 text-sm text-slate">
          Ton navigateur ne prend pas en charge les notifications push.
        </p>
      ) : status === "subscribed" ? (
        <>
          <p className="mt-2 text-sm text-slate">
            Activées — tu recevras tes rappels de révision même app fermée.
          </p>
          <button
            onClick={handleUnsubscribe}
            disabled={busy}
            className="mt-3 rounded-card border border-mist px-4 py-2 text-sm text-ink hover:border-clay hover:text-clay disabled:opacity-60"
          >
            Désactiver
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate">
            Reçois tes rappels de révision et d'examen même quand
            l'application est fermée.
          </p>
          <button
            onClick={handleSubscribe}
            disabled={busy}
            className="mt-3 flex items-center gap-2 rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            <Bell size={15} />
            {busy ? "Activation…" : "Activer les notifications"}
          </button>
          {error && <p className="mt-2 text-sm text-clay">{error}</p>}
        </>
      )}
    </div>
  );
}

const timezoneOptions = [
  { value: "Africa/Douala", label: "Douala / Yaoundé (WAT, UTC+1)" },
  { value: "Africa/Lagos", label: "Lagos (WAT, UTC+1)" },
  { value: "Africa/Abidjan", label: "Abidjan / Dakar (GMT, UTC+0)" },
  { value: "Africa/Kinshasa", label: "Kinshasa (WAT, UTC+1)" },
  { value: "Africa/Nairobi", label: "Nairobi (EAT, UTC+3)" },
  { value: "Europe/Paris", label: "Paris (UTC+1/+2)" },
];

function TimezoneSection() {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userData.user.id)
        .single();
      setTimezone(profile?.timezone ?? "Africa/Douala");
    }
    load();
  }, []);

  async function handleSave(value: string) {
    setTimezone(value);
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { error } = await supabase
        .from("profiles")
        .update({ timezone: value })
        .eq("id", userData.user.id);
      // L'horloge flottante et le compteur de questions du jour suivent ce
      // fuseau : on prévient l'horloge immédiatement.
      if (!error) announceTimezoneChanged(value);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (timezone === null) return null;

  return (
    <div className="mt-6 max-w-lg rounded-card border border-mist bg-white p-6">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-clay" />
        <p className="font-display text-sm text-ink">Fuseau horaire</p>
      </div>
      <p className="mt-2 text-sm text-slate">
        Utilisé pour l'heure de tes rappels de révision et d'examen.
      </p>
      <select
        value={timezone}
        onChange={(e) => handleSave(e.target.value)}
        disabled={saving}
        className="mt-3 w-full rounded-card border border-mist px-3 py-2 text-sm"
      >
        {timezoneOptions.map((tz) => (
          <option key={tz.value} value={tz.value}>
            {tz.label}
          </option>
        ))}
      </select>
      {saved && <p className="mt-2 text-xs text-forest">Enregistré.</p>}
    </div>
  );
}
