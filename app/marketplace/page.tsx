"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AdSlot from "@/components/ads/AdSlot";
import { supabase } from "@/lib/supabase";
import PaymentMethodSelector from "@/components/PaymentMethodSelector";
import { startPayment } from "@/lib/api";
import {
  PAYMENT_METHODS,
  methodRequiresPhone,
  validateMobileMoneyPhone,
  type PaymentMethodId,
} from "@/lib/payment-methods";
import {
  GraduationCap,
  Plus,
  Loader2,
  Video,
  MapPin,
  Trash2,
  Power,
} from "lucide-react";

type Offer = {
  id: string;
  teacher_id: string;
  title: string;
  subject: string;
  description: string;
  price: number;
  format: string;
  active: boolean;
};

type Booking = {
  id: string;
  status: string;
  created_at: string;
  offer: { title: string; price: number } | null;
};

const subjects = ["Mathématiques", "Physique", "Chimie", "Informatique", "Anglais", "Autre"];

type Tab = "browse" | "my-bookings" | "my-offers";

export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [isTeacher, setIsTeacher] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      setUserId(userData.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", userData.user.id)
        .single();
      setIsTeacher(profile?.account_type === "enseignant");
    }
    load();
  }, []);

  return (
    <AppShell active="marketplace" title="Marketplace enseignants">
      <AdSlot slot="marketplace_inline" />
      <p className="mb-4 text-sm text-slate">
        Cours de répétition avec des enseignants — séparé de l'abonnement
        Study Helper, payé par session.
      </p>

      <div className="mb-6 flex gap-2">
        {[
          { key: "browse", label: "Parcourir" },
          { key: "my-bookings", label: "Mes réservations" },
          ...(isTeacher ? [{ key: "my-offers", label: "Mes offres" }] : []),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              tab === t.key ? "bg-ink text-paper" : "border border-mist text-slate"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "browse" && <BrowseTab userId={userId} />}
      {tab === "my-bookings" && <MyBookingsTab />}
      {tab === "my-offers" && isTeacher && <MyOffersTab userId={userId} />}
    </AppShell>
  );
}

function BrowseTab({ userId }: { userId: string | null }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Offre dont le panneau de paiement est ouvert + choix de paiement en cours.
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("tutoring_offers")
        .select("id, teacher_id, title, subject, description, price, format, active")
        .eq("active", true)
        .order("created_at", { ascending: false });
      setOffers(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  function toggleBooking(offerId: string) {
    setError(null);
    setPhoneError(null);
    setOpenOfferId((current) => (current === offerId ? null : offerId));
  }

  // Le numéro est obligatoire en Mobile Money : sans numéro valide, aucun paiement n'est lancé.
  async function handleBook(offer: Offer) {
    if (!method) {
      setError("Choisis un moyen de paiement : MTN MoMo ou Orange Money.");
      return;
    }
    if (methodRequiresPhone(method)) {
      const check = validateMobileMoneyPhone(phone);
      if (!check.ok) {
        setPhoneError(check.error);
        return;
      }
    }
    setPhoneError(null);
    setBookingId(offer.id);
    setError(null);
    try {
      const result = await startPayment({ type: "tutoring", offerId: offer.id, method, phone });
      // Orange Money / carte / PayPal : page officielle du prestataire. MTN MoMo : confirmation sur le
      // téléphone — la page de suivi vérifie le paiement côté serveur.
      window.location.href = result.paymentUrl ?? `/payments/return?ref=${encodeURIComponent(result.ref)}`;
    } catch (err) {
      setBookingId(null);
      setError(err instanceof Error ? err.message : "Échec de la réservation.");
    }
  }

  const filtered = filter === "all" ? offers : offers.filter((o) => o.subject === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 text-xs ${filter === "all" ? "bg-ink text-paper" : "border border-mist text-slate"}`}
        >
          Toutes
        </button>
        {subjects.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-ink text-paper" : "border border-mist text-slate"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-clay">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate">Aucune offre pour l'instant dans cette matière.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((offer) => (
            <div key={offer.id} className="rounded-card border border-mist bg-white p-5">
              <span className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                {offer.subject}
              </span>
              <p className="mt-2 font-display text-base text-ink">{offer.title}</p>
              <p className="mt-1 text-sm text-slate">{offer.description}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate">
                {offer.format === "en_ligne" ? (
                  <span className="flex items-center gap-1">
                    <Video size={13} /> En ligne
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <MapPin size={13} /> Présentiel
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="font-display text-lg text-ink">{offer.price} FCFA</p>
                {offer.teacher_id === userId ? (
                  <span className="text-xs text-slate/60">Ton offre</span>
                ) : (
                  <button
                    onClick={() => toggleBooking(offer.id)}
                    disabled={bookingId === offer.id}
                    className="flex items-center gap-1 rounded-card bg-clay px-3 py-1.5 text-xs text-paper hover:bg-clay/90 disabled:opacity-60"
                  >
                    {openOfferId === offer.id ? "Annuler" : "Réserver"}
                  </button>
                )}
              </div>
              {openOfferId === offer.id && (
                <div className="mt-4 border-t border-mist pt-3">
                  <PaymentMethodSelector
                    allowed={["mtn", "orange"]}
                    value={method}
                    onChange={(id) => {
                      setMethod(id);
                      setPhoneError(null);
                      setError(null);
                    }}
                    phone={phone}
                    onPhoneChange={(value) => {
                      setPhone(value);
                      setPhoneError(null);
                    }}
                    phoneError={phoneError}
                    disabled={bookingId === offer.id}
                  />
                  <button
                    onClick={() => handleBook(offer)}
                    disabled={bookingId === offer.id || !method}
                    className="mt-3 flex w-full items-center justify-center gap-1 rounded-card bg-clay px-3 py-2 text-xs text-paper hover:bg-clay/90 disabled:opacity-60"
                  >
                    {bookingId === offer.id ? <Loader2 size={13} className="animate-spin" /> : null}
                    {method ? `Payer ${offer.price} FCFA avec ${PAYMENT_METHODS[method].label}` : "Choisis un moyen de paiement"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MyBookingsTab() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("tutoring_bookings")
        .select("id, status, created_at, offer:tutoring_offers(title, price)")
        .order("created_at", { ascending: false });
      setBookings((data as unknown as Booking[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const statusLabel: Record<string, string> = {
    pending_payment: "Paiement en attente",
    paid: "Confirmée",
    cancelled: "Annulée",
  };
  const statusColor: Record<string, string> = {
    pending_payment: "text-gold",
    paid: "text-forest",
    cancelled: "text-clay",
  };

  if (loading) return <p className="text-sm text-slate">Chargement…</p>;
  if (bookings.length === 0)
    return <p className="text-sm text-slate">Aucune réservation pour l'instant.</p>;

  return (
    <div className="space-y-3">
      {bookings.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded-card border border-mist bg-white p-4">
          <div>
            <p className="text-sm text-ink">{b.offer?.title ?? "Offre supprimée"}</p>
            <p className="text-xs text-slate">{b.offer?.price} FCFA</p>
          </div>
          <span className={`text-xs font-medium ${statusColor[b.status] ?? "text-slate"}`}>
            {statusLabel[b.status] ?? b.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function MyOffersTab({ userId }: { userId: string | null }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [studentsByOffer, setStudentsByOffer] = useState<Record<string, string[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subject: subjects[0],
    description: "",
    price: "",
    format: "en_ligne",
  });

  async function load() {
    if (!userId) return;
    const { data } = await supabase
      .from("tutoring_offers")
      .select("id, teacher_id, title, subject, description, price, format, active")
      .eq("teacher_id", userId)
      .order("created_at", { ascending: false });
    setOffers(data ?? []);

    // Étudiants ayant payé, avec leur nom (policy RLS dédiée — voir schema.sql)
    const { data: bookings } = await supabase
      .from("tutoring_bookings")
      .select("offer_id, status, student:profiles(full_name)")
      .eq("status", "paid");
    const names: Record<string, string[]> = {};
    for (const b of (bookings as unknown as { offer_id: string; student: { full_name: string } | null }[]) ?? []) {
      const name = b.student?.full_name ?? "Étudiant";
      names[b.offer_id] = [...(names[b.offer_id] ?? []), name];
    }
    setStudentsByOffer(names);
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    await supabase.from("tutoring_offers").insert({
      teacher_id: userId,
      title: form.title,
      subject: form.subject,
      description: form.description,
      price: Number(form.price),
      format: form.format,
      // Pas encore de champ dédié dans le formulaire : durée par défaut
      // d'une session (modifiable plus tard si besoin d'un vrai réglage).
      duration_minutes: 60,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ title: "", subject: subjects[0], description: "", price: "", format: "en_ligne" });
    load();
  }

  async function toggleActive(offer: Offer) {
    await supabase.from("tutoring_offers").update({ active: !offer.active }).eq("id", offer.id);
    load();
  }

  async function removeOffer(id: string) {
    await supabase.from("tutoring_offers").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90"
        >
          <Plus size={16} /> Créer une offre
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded-card border border-mist bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              placeholder="Titre (ex : Soutien Maths Terminale)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="rounded-card border border-mist px-3 py-2 text-sm"
            />
            <select
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="rounded-card border border-mist px-3 py-2 text-sm"
            >
              {subjects.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <textarea
            required
            rows={3}
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-card border border-mist px-3 py-2 text-sm"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              type="number"
              min={1}
              placeholder="Prix (FCFA)"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="rounded-card border border-mist px-3 py-2 text-sm"
            />
            <select
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}
              className="rounded-card border border-mist px-3 py-2 text-sm"
            >
              <option value="en_ligne">En ligne</option>
              <option value="presentiel">Présentiel</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            {saving ? "Création…" : "Publier l'offre"}
          </button>
        </form>
      )}

      {offers.length === 0 ? (
        <p className="text-sm text-slate">Tu n'as pas encore d'offre — crée la première.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {offers.map((offer) => (
            <div key={offer.id} className="rounded-card border border-mist bg-white p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-base text-ink">{offer.title}</p>
                  <p className="text-xs text-slate">{offer.subject} · {offer.price} FCFA</p>
                </div>
                <span className={`text-xs ${offer.active ? "text-forest" : "text-slate/60"}`}>
                  {offer.active ? "Active" : "Désactivée"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate">
                <GraduationCap size={12} className="mr-1 inline" />
                {(studentsByOffer[offer.id]?.length ?? 0)} réservation(s) payée(s)
                {studentsByOffer[offer.id]?.length ? (
                  <span className="block text-ink">
                    {studentsByOffer[offer.id].join(", ")}
                  </span>
                ) : null}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => toggleActive(offer)}
                  className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink"
                >
                  <Power size={12} /> {offer.active ? "Désactiver" : "Activer"}
                </button>
                <button
                  onClick={() => removeOffer(offer.id)}
                  className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-clay hover:border-clay"
                >
                  <Trash2 size={12} /> Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
