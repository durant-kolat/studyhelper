"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { ShieldOff, Megaphone, CheckCircle2, XCircle, ArrowLeft, Save, Info } from "lucide-react";
import {
  AD_FORMATS, AD_FORMAT_LABELS, AD_PAGES, AD_SLOTS, decideAd, defaultConfig, providerStatus, sanitizeConfig,
  type AdConfig, type AdFormat,
} from "@/lib/ads/config";
import { placeholderAllowed, providerEnv } from "@/lib/ads/provider-env";

const OUTCOME_LABEL: Record<string, string> = {
  network: "Publicité AdSense",
  house: "Promotion Study Helper",
  placeholder: "Emplacement de remplacement (aperçu)",
  consent: "Demande de consentement",
  none: "Rien",
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#1a1a1a]" />
      {label}
    </label>
  );
}

function Ok({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 size={14} className="text-forest" aria-label="oui" /> : <XCircle size={14} className="text-clay" aria-label="non" />;
}

export default function AdminAdsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [config, setConfig] = useState<AdConfig>(defaultConfig());
  const [source, setSource] = useState<"db" | "default">("default");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const provider = useMemo(() => providerStatus(providerEnv), []);

  useEffect(() => {
    async function load() {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      const { data: me } = await supabase.from("profiles").select("role").eq("id", u.user.id).single();
      // Affichage seulement : la vraie protection est la RLS de ad_settings (écriture = public.is_admin()).
      const isAdmin = me?.role === "admin";
      setAllowed(isAdmin);
      if (!isAdmin) { setLoading(false); return; }
      const { data, error } = await supabase.from("ad_settings").select("config").eq("id", "global").maybeSingle();
      if (error) {
        setMessage({ kind: "error", text: "Réglages illisibles — la migration supabase/migration-v2.8-ad-settings.sql a-t-elle été exécutée ? Valeurs par défaut affichées." });
      } else if (data) {
        setConfig(sanitizeConfig(data.config));
        setSource("db");
      }
      setLoading(false);
    }
    load();
  }, []);

  function update(fn: (c: AdConfig) => void) {
    setConfig((prev) => {
      const next: AdConfig = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const clean = sanitizeConfig(config);
    const { error } = await supabase.from("ad_settings").upsert({
      id: "global", config: clean, updated_at: new Date().toISOString(), updated_by: userId,
    });
    setSaving(false);
    if (error) {
      setMessage({ kind: "error", text: `Enregistrement refusé : ${error.message}. Seul un administrateur peut modifier ces réglages ; vérifie aussi que la migration v2.8 est passée.` });
      return;
    }
    setConfig(clean);
    setSource("db");
    setMessage({ kind: "ok", text: "Réglages enregistrés. Ils s'appliquent à la prochaine page chargée par chaque utilisateur." });
  }

  if (allowed === false) {
    return (
      <AppShell active="admin" title="Publicités">
        <div className="flex flex-col items-center gap-2 rounded-card border border-mist bg-white p-10 text-center">
          <ShieldOff size={28} className="text-clay" />
          <p className="text-sm text-ink">Cette page est réservée aux administrateurs.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="admin" title="Publicités">
      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : (
        <div className="space-y-8">
          <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-slate hover:text-ink">
            <ArrowLeft size={13} /> Administration
          </Link>

          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-card px-3 py-2 text-sm ${message.kind === "error" ? "bg-clay/10 text-clay" : "bg-forest/10 text-forest"}`}>
              {message.text}
            </p>
          )}
          {source === "default" && !message && (
            <p className="flex items-start gap-2 rounded-card border border-mist bg-mist2 px-3 py-2 text-xs text-slate">
              <Info size={14} className="mt-0.5 shrink-0" />
              Aucun réglage enregistré en base pour l'instant : valeurs par défaut affichées. Tant qu'aucun réglage n'est lu en base, aucune publicité tierce n'est diffusée.
            </p>
          )}

          {/* Fournisseur */}
          <section>
            <p className="mb-3 flex items-center gap-2 font-display text-base text-ink"><Megaphone size={16} className="text-clay" /> État du fournisseur publicitaire</p>
            <div className="rounded-card border border-mist bg-white p-4 text-sm">
              <ul className="space-y-2">
                <li className="flex items-center gap-2"><Ok ok={provider.clientConfigured} /> Identifiant d'éditeur Google AdSense <code className="text-xs text-slate">NEXT_PUBLIC_ADSENSE_CLIENT</code> {provider.clientConfigured ? "valide" : "non renseigné ou invalide"}</li>
                <li className="flex items-center gap-2"><Ok ok={placeholderAllowed} /> Emplacements de remplacement {placeholderAllowed ? "autorisés (développement ou NEXT_PUBLIC_ADS_PLACEHOLDER=true)" : "interdits (production)"}</li>
              </ul>
              <p className="mt-3 text-xs text-slate">
                Tant que l'identifiant d'éditeur et l'identifiant de bloc d'un emplacement ne sont pas renseignés dans les variables d'environnement, aucune publicité tierce n'est chargée.
                Study Helper ne génère, n'estime ni ne simule aucun revenu : la diffusion réelle se vérifie dans ton compte AdSense (compte et site approuvés, fichier <code>ads.txt</code> publié, consentement conforme).
              </p>
            </div>
          </section>

          {/* Général */}
          <section>
            <p className="mb-3 font-display text-base text-ink">Général</p>
            <div className="space-y-3 rounded-card border border-mist bg-white p-4">
              <Switch checked={config.globalEnabled} onChange={(v) => update((c) => { c.globalEnabled = v; })} label="Publicités activées (interrupteur général)" />
              <Switch checked={config.houseFallback} onChange={(v) => update((c) => { c.houseFallback = v; })} label="Afficher la promotion Study Helper (Premium) quand aucune publicité tierce n'est servie" />
              <p className="text-xs text-slate">Les comptes Premium ne voient jamais de publicité. Les examens, quiz, exercices, assistant, espace Carrière, planning, paiements, profil et discussions vocales n'en affichent jamais : ces pages ne figurent pas dans la liste ci-dessous et ne peuvent pas être ajoutées.</p>
            </div>
          </section>

          {/* Pages */}
          <section>
            <p className="mb-3 font-display text-base text-ink">Pages autorisées</p>
            <div className="grid gap-3 rounded-card border border-mist bg-white p-4 sm:grid-cols-2">
              {AD_PAGES.map((p) => (
                <Switch key={p.key} checked={config.pages[p.key]} onChange={(v) => update((c) => { c.pages[p.key] = v; })} label={`${p.label} (${p.path})`} />
              ))}
            </div>
          </section>

          {/* Formats */}
          <section>
            <p className="mb-3 font-display text-base text-ink">Formats pris en charge</p>
            <div className="grid gap-3 rounded-card border border-mist bg-white p-4 sm:grid-cols-2">
              {AD_FORMATS.map((f) => (
                <Switch key={f} checked={config.formats[f]} onChange={(v) => update((c) => { c.formats[f] = v; })} label={AD_FORMAT_LABELS[f]} />
              ))}
              <p className="text-xs text-slate sm:col-span-2">Le format choisi pour un emplacement doit correspondre au type de bloc créé dans AdSense (un bloc « in-article » pour « Dans le contenu »).</p>
            </div>
          </section>

          {/* Emplacements */}
          <section>
            <p className="mb-3 font-display text-base text-ink">Emplacements</p>
            <div className="overflow-x-auto rounded-card border border-mist bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-mist text-xs text-slate">
                  <tr>
                    <th className="px-4 py-3">Actif</th>
                    <th className="px-4 py-3">Emplacement</th>
                    <th className="px-4 py-3">Format</th>
                    <th className="px-4 py-3">Bloc AdSense</th>
                    <th className="px-4 py-3">Rendu (compte gratuit, consentement donné)</th>
                  </tr>
                </thead>
                <tbody>
                  {AD_SLOTS.map((s) => {
                    const cur = config.slots[s.id];
                    const page = AD_PAGES.find((p) => p.key === s.page)!;
                    const d = decideAd({
                      slotId: s.id, pathname: page.path, premium: "free", configSource: source, config, consent: "granted",
                      provider: providerEnv, placeholderAllowed,
                    });
                    return (
                      <tr key={s.id} className="border-b border-mist align-top last:border-0">
                        <td className="px-4 py-3">
                          <input type="checkbox" aria-label={`Activer ${s.label}`} checked={cur.enabled} onChange={(e) => update((c) => { c.slots[s.id].enabled = e.target.checked; })} className="h-4 w-4 accent-[#1a1a1a]" />
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink">{s.label}</p>
                          <p className="text-xs text-slate">{s.where}</p>
                        </td>
                        <td className="px-4 py-3">
                          <select value={cur.format} onChange={(e) => update((c) => { c.slots[s.id].format = e.target.value as AdFormat; })} className="rounded-card border border-mist px-2 py-1 text-xs">
                            {AD_FORMATS.map((f) => (
                              <option key={f} value={f} disabled={!config.formats[f]}>{AD_FORMAT_LABELS[f]}</option>
                            ))}
                          </select>
                          {!config.formats[cur.format] && <p className="mt-1 text-xs text-clay">Format non pris en charge</p>}
                        </td>
                        <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs"><Ok ok={provider.unitsConfigured[s.id]} /> {provider.unitsConfigured[s.id] ? "renseigné" : "non renseigné"}</span></td>
                        <td className="px-4 py-3 text-xs text-slate">{OUTCOME_LABEL[d.kind]}{d.kind === "none" ? ` — ${d.reason}` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Statistiques */}
          <section>
            <p className="mb-3 font-display text-base text-ink">Statistiques</p>
            <div className="rounded-card border border-mist bg-white p-4 text-sm text-slate">
              <p>
                Study Helper ne collecte aucune statistique d'impressions, de clics ou de revenus : aucun chiffre n'est affiché ici plutôt que d'en inventer.
                Les statistiques réelles sont dans ton compte Google AdSense.
              </p>
              <p className="mt-2 text-xs">
                Configuration actuelle : {Object.values(config.slots).filter((s) => s.enabled).length}/{AD_SLOTS.length} emplacements actifs · {Object.values(config.pages).filter(Boolean).length}/{AD_PAGES.length} pages autorisées · {provider.ready ? Object.values(provider.unitsConfigured).filter(Boolean).length : 0} bloc(s) AdSense renseigné(s).
              </p>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60">
              <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={() => { setConfig(defaultConfig()); setMessage(null); }} className="text-xs text-slate underline hover:text-ink">
              Rétablir les valeurs par défaut (non enregistré)
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
