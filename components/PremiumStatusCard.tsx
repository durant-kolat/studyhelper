"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Crown, Loader2, RefreshCw, XCircle } from "lucide-react";
import PremiumCheckoutSheet from "./PremiumCheckoutSheet";
import { PaymentError, fetchPremiumOverview, setAutoRenew } from "@/lib/api";
import { formatDateFr, type SubscriptionStatus } from "@/lib/premium";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@/lib/quota-limits";
import type { PaymentStatus, PaymentView, PremiumOverview } from "@/lib/billing/types";

const STATUS_BADGE: Record<SubscriptionStatus, { label: string; className: string }> = {
  active: { label: "Actif", className: "bg-forest/15 text-forest" },
  expiring_soon: { label: "Expire bientôt", className: "bg-gold/30 text-ink" },
  expired: { label: "Expiré", className: "bg-clay/15 text-clay" },
  pending: { label: "Paiement en cours de vérification", className: "bg-gold/30 text-ink" },
  failed: { label: "Dernier paiement échoué", className: "bg-clay/15 text-clay" },
  cancelled: { label: "Paiement annulé", className: "bg-mist2 text-slate" },
  none: { label: "Gratuit", className: "bg-mist2 text-slate" },
};

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, { label: string; className: string }> = {
  success: { label: "Confirmé", className: "text-forest" },
  pending: { label: "En cours de vérification", className: "text-ink" },
  failed: { label: "Échoué", className: "text-clay" },
  cancelled: { label: "Annulé", className: "text-slate" },
  expired: { label: "Expiré", className: "text-slate" },
};

const INITIAL_HISTORY = 5;

/**
 * Carte « Abonnement » du profil : statut, date d'expiration, jours restants, renouvellement,
 * rappels, historique des paiements/renouvellements. Toutes les données viennent du SERVEUR
 * (/api/premium/status) : le navigateur n'affiche que ce que le serveur a vérifié.
 */
export default function PremiumStatusCard({ accountType }: { accountType: string }) {
  const [overview, setOverview] = useState<PremiumOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setOverview(await fetchPremiumOverview());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Impossible de charger ton abonnement.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Les rappels de renouvellement (notification push) ouvrent /profile?subscribe=1.
  useEffect(() => {
    if (overview && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("subscribe") === "1") {
      setSheetOpen(true);
    }
  }, [overview]);

  async function disableAutoRenew() {
    setBusy(true);
    setActionError(null);
    try {
      await setAutoRenew(false);
      await load();
    } catch (err) {
      setActionError(err instanceof PaymentError || err instanceof Error ? err.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="border-t border-mist pt-6">
        <p role="alert" className="text-sm text-clay">{loadError}</p>
        <button onClick={load} className="mt-2 flex items-center gap-1.5 text-xs text-ink underline">
          <RefreshCw size={12} /> Réessayer
        </button>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="border-t border-mist pt-6">
        <p className="flex items-center gap-2 text-sm text-slate">
          <Loader2 size={14} className="animate-spin" /> Chargement de ton abonnement…
        </p>
      </div>
    );
  }

  const sub = overview.subscription;
  const badge = STATUS_BADGE[sub.status];
  const isEntreprise = accountType === "entreprise";
  const renewing = sub.isActive; // Premium encore actif → « Renouveler » prolonge la période restante
  const history = showAll ? overview.history : overview.history.slice(0, INITIAL_HISTORY);

  return (
    <div className="border-t border-mist pt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {sub.isActive && <Crown size={16} className="text-gold" />}
        <p className="font-display text-sm text-ink">Abonnement — {sub.isActive ? "Premium" : "Gratuit"}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      {/* Dates : expiration, jours restants, début */}
      {sub.isActive ? (
        <div className="space-y-0.5 text-sm text-slate">
          {sub.isUnlimited ? (
            <p>Premium sans date d&apos;expiration.</p>
          ) : (
            <>
              <p>
                Votre Premium expire le : <strong className="text-ink">{formatDateFr(sub.expiresAt)}</strong>
              </p>
              <p>
                Jours restants : <strong className="text-ink">{sub.daysRemaining}</strong>
              </p>
            </>
          )}
          {sub.startedAt && <p>Premium actif depuis le : {formatDateFr(sub.startedAt)}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate">
          {sub.baseStatus === "expired" && sub.expiresAt
            ? `Votre Premium a expiré le ${formatDateFr(sub.expiresAt)}.`
            : `Passez Premium : sans publicité, accès aux groupes d'étude inclus et jusqu'à ${PREMIUM_LIMITS.assistant} questions par jour à l'assistant IA (contre ${FREE_LIMITS.assistant} en gratuit).`}
        </p>
      )}

      {/* Alertes */}
      {sub.status === "expiring_soon" && (
        <p className="mt-3 flex items-start gap-2 rounded-card bg-gold/20 px-3 py-2 text-xs text-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Votre Premium expire dans {sub.daysRemaining} jour{(sub.daysRemaining ?? 0) > 1 ? "s" : ""}. Renouvelez-le dès
          maintenant : la nouvelle période s&apos;ajoute à la durée restante.
        </p>
      )}
      {sub.status === "failed" && (
        <p className="mt-3 flex items-start gap-2 rounded-card bg-clay/10 px-3 py-2 text-xs text-ink">
          <XCircle size={14} className="mt-0.5 shrink-0 text-clay" />
          Votre dernier paiement n&apos;a pas abouti. Aucun montant n&apos;est conservé sans activation : vous pouvez réessayer.
        </p>
      )}
      {sub.status === "cancelled" && (
        <p className="mt-3 flex items-start gap-2 rounded-card bg-mist2 px-3 py-2 text-xs text-slate">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          Votre dernier paiement a été annulé.
        </p>
      )}

      {/* Paiement en attente */}
      {overview.pendingPayment && (
        <div className="mt-3 rounded-card border border-gold/60 bg-gold/10 p-3 text-sm text-ink">
          <p className="flex items-center gap-2 font-medium">
            <Clock size={14} /> Paiement en cours de vérification
          </p>
          <p className="mt-1 text-xs text-slate">
            Premium sera activé dès que le paiement sera confirmé. Rien n&apos;est activé avant.
          </p>
          <a
            href={`/payments/return?ref=${encodeURIComponent(overview.pendingPayment.ref)}`}
            className="mt-2 inline-block rounded-card bg-ink px-3 py-1.5 text-xs text-paper hover:bg-ink/90"
          >
            Suivre ce paiement
          </a>
        </div>
      )}

      {/* Action principale */}
      {isEntreprise ? (
        <a
          href="mailto:contact@studyhelper.app?subject=Offre%20Entreprise"
          className="mt-3 inline-block rounded-card border border-mist px-4 py-2 text-sm text-ink hover:border-ink"
        >
          Offre Entreprise : nous contacter
        </a>
      ) : sub.isUnlimited || overview.plans.length === 0 ? null : (
        !overview.pendingPayment && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-3 flex items-center gap-2 rounded-card bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold/90"
          >
            <Crown size={15} />
            {renewing ? "Renouveler mon Premium" : "S’abonner à Premium"}
          </button>
        )
      )}

      {/* Renouvellement : automatique (seulement si réellement supporté) ou manuel + rappels */}
      {sub.isActive && !sub.isUnlimited && (
        <div className="mt-3 text-xs text-slate">
          {overview.autoRenew.enabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-ink">
                <CheckCircle2 size={13} className="text-forest" /> Renouvellement automatique activé
              </span>
              <button
                type="button"
                onClick={disableAutoRenew}
                disabled={busy}
                className="rounded-card border border-mist px-2.5 py-1 text-xs text-ink hover:border-ink disabled:opacity-60"
              >
                {busy ? "…" : "Désactiver"}
              </button>
            </div>
          ) : (
            <p>
              Renouvellement manuel : nous vous prévenons {overview.reminderDays.filter((d) => d > 0).join(" jours, ")} jours
              avant l&apos;expiration, puis le jour même.
            </p>
          )}
          {actionError && <p role="alert" className="mt-1 text-clay">{actionError}</p>}
        </div>
      )}

      {/* Historique des paiements et renouvellements */}
      {overview.history.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 font-display text-sm text-ink">Historique des paiements</p>
          <ul className="divide-y divide-mist rounded-card border border-mist">
            {history.map((p) => (
              <HistoryRow key={p.ref} payment={p} />
            ))}
          </ul>
          {overview.history.length > INITIAL_HISTORY && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-slate underline hover:text-ink">
              {showAll ? "Réduire" : `Voir tout (${overview.history.length})`}
            </button>
          )}
        </div>
      )}

      <PremiumCheckoutSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          if (typeof window !== "undefined" && window.location.search.includes("subscribe=1")) {
            window.history.replaceState(null, "", window.location.pathname);
          }
          load();
        }}
        overview={overview}
      />
    </div>
  );
}

function HistoryRow({ payment: p }: { payment: PaymentView }) {
  const status = PAYMENT_STATUS_LABEL[p.status];
  return (
    <li className="px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink">
          {formatDateFr(p.paidAt ?? p.createdAt)} · {p.durationDays ? `${p.durationDays} jours` : "Premium"}
          {p.renewal && p.status === "success" ? " · renouvellement" : ""}
        </span>
        <span className={`font-medium ${status.className}`}>{status.label}</span>
      </div>
      <p className="mt-0.5 text-slate">
        {p.status === "success" ? (p.paidAmount ?? p.amount) : p.amount} FCFA · {p.methodLabel}
        {p.status === "success" && p.periodStart && p.periodEnd
          ? ` · du ${formatDateFr(p.periodStart)} au ${formatDateFr(p.periodEnd)}`
          : ""}
      </p>
      <p className="mt-0.5 break-all font-mono text-[10px] text-slate/70">
        Réf. {p.ref}
        {p.providerTxnId ? ` · Transaction ${p.providerTxnId}` : ""}
      </p>
    </li>
  );
}
