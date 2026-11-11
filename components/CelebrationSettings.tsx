"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { HOLIDAYS, isValidMonthDay } from "@/lib/celebrations";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MAX_DAY: Record<number, number> = { 1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };

type State = {
  celebrations_enabled: boolean;
  birthday_enabled: boolean;
  birth_month: number | null;
  birth_day: number | null;
  feast_enabled: boolean;
  feast_label: string;
  feast_month: number | null;
  feast_day: number | null;
  holidays: string[];
};
const EMPTY: State = { celebrations_enabled: false, birthday_enabled: false, birth_month: null, birth_day: null, feast_enabled: false, feast_label: "", feast_month: null, feast_day: null, holidays: [] };

function DayPicker({ idBase, month, day, onChange, disabled }: { idBase: string; month: number | null; day: number | null; onChange: (m: number | null, d: number | null) => void; disabled: boolean }) {
  const sel = "rounded-card border border-mist px-3 py-2 text-sm";
  const max = month ? MAX_DAY[month] : 31;
  return (
    <div className="flex gap-2">
      <select id={`${idBase}-day`} aria-label="Jour" className={sel} disabled={disabled} value={day ?? ""} onChange={(e) => onChange(month, e.target.value ? Number(e.target.value) : null)}>
        <option value="">Jour</option>
        {Array.from({ length: max }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select id={`${idBase}-month`} aria-label="Mois" className={sel} disabled={disabled} value={month ?? ""} onChange={(e) => {
        const m = e.target.value ? Number(e.target.value) : null;
        onChange(m, m && day && day > MAX_DAY[m] ? null : day);
      }}>
        <option value="">Mois</option>
        {MONTHS.map((n, i) => (
          <option key={n} value={i + 1}>{n}</option>
        ))}
      </select>
    </div>
  );
}

/** Réglages FACULTATIFS des célébrations (désactivées par défaut). Jour et mois seulement : l'année de naissance n'est jamais demandée. */
export default function CelebrationSettings() {
  const [s, setS] = useState<State>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("celebration_prefs").select("*").maybeSingle();
      if (data) setS({ ...EMPTY, ...data, feast_label: data.feast_label ?? "", holidays: data.holidays ?? [] });
      setLoaded(true);
    })();
  }, []);

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));
  const toggleHoliday = (key: string) => set("holidays", s.holidays.includes(key) ? s.holidays.filter((k) => k !== key) : [...s.holidays, key]);

  async function save() {
    setMsg(null);
    if (s.birthday_enabled && !isValidMonthDay(s.birth_month, s.birth_day)) return setMsg({ ok: false, text: "Choisis un jour et un mois valides pour ton anniversaire." });
    if (s.feast_enabled && !isValidMonthDay(s.feast_month, s.feast_day)) return setMsg({ ok: false, text: "Choisis un jour et un mois valides pour ta fête." });
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return setMsg({ ok: false, text: "Session expirée : reconnecte-toi." });
    setBusy(true);
    const { error } = await supabase.from("celebration_prefs").upsert(
      {
        owner_id: uid,
        celebrations_enabled: s.celebrations_enabled,
        birthday_enabled: s.birthday_enabled,
        birth_month: s.birthday_enabled ? s.birth_month : null,
        birth_day: s.birthday_enabled ? s.birth_day : null,
        feast_enabled: s.feast_enabled,
        feast_label: s.feast_enabled && s.feast_label.trim() ? s.feast_label.trim().slice(0, 60) : null,
        feast_month: s.feast_enabled ? s.feast_month : null,
        feast_day: s.feast_enabled ? s.feast_day : null,
        holidays: s.holidays,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
    setBusy(false);
    setMsg(error ? { ok: false, text: "Enregistrement impossible. Réessaie." } : { ok: true, text: "Préférences de célébration enregistrées." });
  }

  async function wipe() {
    if (!window.confirm("Supprimer tes dates et préférences de célébration ?")) return;
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from("celebration_prefs").delete().eq("owner_id", uid);
    if (!error) setS(EMPTY);
    setMsg(error ? { ok: false, text: "Suppression impossible. Réessaie." } : { ok: true, text: "Dates et préférences supprimées." });
  }

  if (!loaded) return null;
  const off = !s.celebrations_enabled;
  return (
    <section className="mt-6 rounded-card border border-mist bg-white p-5">
      <h2 className="font-display text-lg text-ink">Anniversaire et fêtes</h2>
      <p className="mt-1 text-sm text-slate">
        Facultatif et désactivé par défaut. Study Helper peut te souhaiter un joyeux anniversaire ou une bonne fête, à la date réelle dans ton fuseau horaire
        (message dans l&apos;application, et notification si tu as activé les notifications push). Nous ne gardons que le jour et le mois de ta naissance, jamais l&apos;année.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={s.celebrations_enabled} onChange={(e) => set("celebrations_enabled", e.target.checked)} />
        Activer les célébrations
      </label>

      <div className={`mt-4 space-y-5 ${off ? "opacity-50" : ""}`}>
        <div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" disabled={off} checked={s.birthday_enabled} onChange={(e) => set("birthday_enabled", e.target.checked)} />
            🎂 Me souhaiter mon anniversaire
          </label>
          {s.birthday_enabled && (
            <div className="mt-2">
              <DayPicker idBase="birth" month={s.birth_month} day={s.birth_day} disabled={off} onChange={(m, d) => setS((p) => ({ ...p, birth_month: m, birth_day: d }))} />
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" disabled={off} checked={s.feast_enabled} onChange={(e) => set("feast_enabled", e.target.checked)} />
            🎉 Me souhaiter ma fête (jour que je choisis)
          </label>
          {s.feast_enabled && (
            <div className="mt-2 space-y-2">
              <input aria-label="Nom de la fête (facultatif)" maxLength={60} placeholder="Nom de la fête (facultatif)" disabled={off} value={s.feast_label} onChange={(e) => set("feast_label", e.target.value)} className="w-full rounded-card border border-mist px-3 py-2 text-sm" />
              <DayPicker idBase="feast" month={s.feast_month} day={s.feast_day} disabled={off} onChange={(m, d) => setS((p) => ({ ...p, feast_month: m, feast_day: d }))} />
            </div>
          )}
        </div>

        <fieldset>
          <legend className="text-sm text-ink">Fêtes à date fixe à souhaiter</legend>
          <div className="mt-2 space-y-1">
            {HOLIDAYS.map((h) => (
              <label key={h.key} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" disabled={off} checked={s.holidays.includes(h.key)} onChange={() => toggleHoliday(h.key)} />
                {h.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate">Les fêtes mobiles (qui changent de date chaque année) ne sont pas proposées : une date inexacte serait pire que pas de message.</p>
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className="rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">Enregistrer</button>
        <button type="button" onClick={wipe} className="rounded-card border border-mist px-4 py-2 text-sm text-ink hover:bg-mist2">Supprimer mes dates</button>
      </div>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-forest" : "text-clay"}`}>{msg.text}</p>}
    </section>
  );
}
