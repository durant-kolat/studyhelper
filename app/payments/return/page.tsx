"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { PaymentError, cancelPayment, verifyPayment } from "@/lib/api";
import { formatDateFr } from "@/lib/premium";
import type { PaymentStatus, PaymentView, PremiumSummary } from "@/lib/billing/types";

const POLL_MS = 3000;
const POLL_SLOW_MS = 6000; // après la première minute
const MAX_POLL_MS = 10 * 60_000; // ~10 min, puis on arrête d'insister (le serveur continue de rapprocher)


function ReturnContent() {
  const { t } = useI18n();
  // Libellés dans la langue de l'utilisateur (le statut lui-même vient TOUJOURS de la vérification serveur).
  const STATUS_LABEL: Record<PaymentStatus, string> = {
    success: t("pay.status.success"),
    pending: t("pay.status.pending"),
    failed: t("pay.status.failed"),
    cancelled: t("pay.status.cancelled"),
    expired: t("pay.status.expired"),
  };
  const params = useSearchParams();
  // `ref` = notre référence de transaction. `transaction_id` : ancien format de lien (compatibilité).
  const ref = params.get("ref") ?? params.get("transaction_id");
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [premium, setPremium] = useState<PremiumSummary | null>(null);
  const [fatal, setFatal] = useState<{ message: string; login?: boolean } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Le navigateur ne décide JAMAIS que c'est payé : il demande au SERVEUR de vérifier le paiement
  // auprès du prestataire (MTN, Orange Money ou PayPal) et affiche l'état réel renvoyé.
  // Tant que le paiement est « pending », rien n'est activé.
  useEffect(() => {
    if (!ref) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let failures = 0;

    async function tick() {
      try {
        const result = await verifyPayment(ref as string);
        if (stopped) return;
        failures = 0;
        setFatal(null);
        setPayment(result.payment);
        setPremium(result.premium);
        if (result.payment.status !== "pending") return; // état final : on s'arrête
      } catch (err) {
        if (stopped) return;
        if (err instanceof PaymentError && err.status === 401) {
          setFatal({ message: "Votre session a expiré. Reconnectez-vous pour voir l'état de votre paiement.", login: true });
          return;
        }
        if (err instanceof PaymentError && err.status === 404) {
          setFatal({ message: "Ce paiement est introuvable sur votre compte." });
          return;
        }
        failures += 1; // réseau / erreur serveur : on réessaie quelques fois
        if (failures >= 5) {
          setFatal({ message: err instanceof Error ? err.message : "Vérification impossible pour le moment." });
          return;
        }
      }
      if (Date.now() - startedAt > MAX_POLL_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(tick, Date.now() - startedAt < 60_000 ? POLL_MS : POLL_SLOW_MS);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [ref]);

  async function handleCancel() {
    if (!ref) return;
    setCancelling(true);
    setCancelError(null);
    try {
      setPayment(await cancelPayment(ref));
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Annulation impossible.");
    } finally {
      setCancelling(false);
    }
  }

  const status = payment?.status ?? null;
  const isPremiumPayment = payment?.type === "premium";
  const retryHref = payment?.type === "tutoring" ? "/marketplace" : "/profile?subscribe=1";
  const continueHref = payment?.type === "tutoring" ? "/marketplace" : "/profile";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <div className="w-full max-w-md rounded-card border border-mist bg-white p-6">
        {/* Cas sans référence / erreur définitive */}
        {!ref && (
          <Message
            icon={<XCircle size={32} className="mx-auto text-clay" />}
            title="Paiement introuvable"
            text="Cette page a besoin d'une référence de paiement. Retournez sur votre profil pour vérifier votre abonnement."
          >
            <PrimaryLink href="/profile">Retour au profil</PrimaryLink>
          </Message>
        )}
        {ref && fatal && (
          <Message icon={<XCircle size={32} className="mx-auto text-clay" />} title="Vérification impossible" text={fatal.message}>
            <PrimaryLink href={fatal.login ? "/login" : "/profile"}>{fatal.login ? "Se reconnecter" : "Retour au profil"}</PrimaryLink>
          </Message>
        )}

        {/* Première vérification en cours */}
        {ref && !fatal && !payment && (
          <Message
            icon={<Loader2 size={32} className="mx-auto animate-spin text-clay" />}
            title="Vérification du paiement…"
            text="Nous interrogeons votre opérateur. Ne fermez pas cette page."
          />
        )}

        {ref && !fatal && payment && (
          <>
            {/* En-tête selon le statut */}
            {status === "success" && (
              <Header icon={<CheckCircle2 size={34} className="mx-auto text-forest" />} title={STATUS_LABEL.success} />
            )}
            {status === "pending" && !timedOut && (
              <Header icon={<Loader2 size={34} className="mx-auto animate-spin text-clay" />} title={STATUS_LABEL.pending} />
            )}
            {status === "pending" && timedOut && (
              <Header icon={<Clock size={34} className="mx-auto text-gold" />} title="Vérification toujours en cours" />
            )}
            {(status === "failed" || status === "cancelled" || status === "expired") && (
              <Header icon={<XCircle size={34} className="mx-auto text-clay" />} title={STATUS_LABEL[status]} />
            )}

            {/* Explications */}
            {status === "pending" && !timedOut && (
              <div className="mt-2 text-center text-sm text-slate">
                {payment.flow === "push" ? (
                  <p>
                    Une demande de paiement a été envoyée{payment.payerMasked ? ` au ${payment.payerMasked}` : " à votre téléphone"}.
                    Confirmez-la vous-même dans l&apos;interface {payment.methodLabel}. Ne communiquez jamais votre code secret (PIN) à
                    qui que ce soit.
                  </p>
                ) : (
                  <p>
                    Si vous avez déjà payé, patientez quelques instants : la confirmation de {payment.methodLabel} est vérifiée
                    automatiquement. Premium n&apos;est activé qu&apos;après cette confirmation.
                  </p>
                )}
                {payment.expiresAt && (
                  <p className="mt-1 text-xs text-slate/70">
                    Cette demande expire à {new Date(payment.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
                  </p>
                )}
              </div>
            )}
            {status === "pending" && timedOut && (
              <p className="mt-2 text-center text-sm text-slate">
                La confirmation prend plus de temps que prévu. Si l&apos;argent a été débité, Premium sera activé automatiquement dès
                que votre opérateur confirmera le paiement (vérification toutes les heures). Conservez la référence ci-dessous.
              </p>
            )}
            {status === "failed" && (
              <p className="mt-2 text-center text-sm text-slate">
                Le paiement n&apos;a pas abouti et rien n&apos;a été activé. Vous pouvez réessayer.
              </p>
            )}
            {status === "cancelled" && (
              <p className="mt-2 text-center text-sm text-slate">Ce paiement a été annulé. Rien n&apos;a été activé.</p>
            )}
            {status === "expired" && (
              <p className="mt-2 text-center text-sm text-slate">
                La demande de paiement a expiré. Si l&apos;argent a tout de même été débité, Premium sera activé dès la confirmation
                de l&apos;opérateur ; sinon, relancez un paiement.
              </p>
            )}

            {/* Détails de la transaction */}
            <dl className="mt-5 space-y-2 rounded-card bg-mist2 px-4 py-3 text-sm">
              <Row label="Statut du paiement" value={STATUS_LABEL[payment.status]} />
              <Row label="Référence de transaction" value={payment.ref} mono />
              {payment.providerTxnId && <Row label="Transaction de l'opérateur" value={payment.providerTxnId} mono />}
              <Row label="Moyen de paiement" value={payment.methodLabel} />
              <Row
                label={status === "success" ? "Montant payé" : "Montant"}
                value={`${status === "success" ? (payment.paidAmount ?? payment.amount) : payment.amount} FCFA`}
              />
            </dl>

            {/* Premium : nouveau statut et dates */}
            {status === "success" && isPremiumPayment && (
              <div className="mt-3 rounded-card border border-forest/30 bg-forest/5 px-4 py-3 text-sm">
                <p className="mb-1.5 font-display text-ink">Votre Premium</p>
                <dl className="space-y-1.5">
                  <Row
                    label="Nouveau statut Premium"
                    value={premium && !premium.isActive ? "Inactif" : premium?.status === "expiring_soon" ? "Actif (expire bientôt)" : "Actif"}
                    strong
                  />
                  <Row label="Date de début" value={formatDateFr(payment.periodStart)} />
                  <Row label="Nouvelle date d'expiration" value={formatDateFr(payment.periodEnd)} strong />
                  {premium?.daysRemaining != null && <Row label="Jours restants" value={String(premium.daysRemaining)} />}
                </dl>
                {payment.renewal && (
                  <p className="mt-2 text-xs text-slate">
                    Votre Premium était encore actif : cette période a été ajoutée à la durée restante (début de la période = fin
                    de l&apos;ancienne échéance).
                  </p>
                )}
              </div>
            )}
            {status === "success" && payment.type === "tutoring" && (
              <p className="mt-3 text-center text-sm text-slate">Votre réservation est confirmée.</p>
            )}

            {/* Actions */}
            <div className="mt-5 flex flex-col gap-2">
              {status === "success" && <PrimaryLink href={continueHref}>Continuer</PrimaryLink>}
              {status === "pending" && (
                <>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="rounded-card border border-mist px-5 py-2.5 text-sm text-ink hover:border-ink disabled:opacity-60"
                  >
                    {cancelling ? t("common.loading") : t("common.cancel")}
                  </button>
                  {payment.flow === "push" && (
                    <p className="text-center text-[11px] text-slate/70">
                      Si vous avez déjà reçu la demande sur votre téléphone, ne la confirmez pas après l&apos;annulation.
                    </p>
                  )}
                  {cancelError && (
                    <p role="alert" className="text-center text-xs text-clay">
                      {cancelError}
                    </p>
                  )}
                </>
              )}
              {(status === "failed" || status === "cancelled" || status === "expired") && (
                <PrimaryLink href={retryHref}>{t("common.retry")}</PrimaryLink>
              )}
              {status !== "success" && (
                <Link href={continueHref} className="text-center text-xs text-slate underline hover:text-ink">
                  Retour
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Header({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="text-center">
      {icon}
      <h1 className="mt-3 font-display text-xl text-ink">{title}</h1>
    </div>
  );
}

function Message({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      {icon}
      <p className="mt-3 font-display text-lg text-ink">{title}</p>
      <p className="mt-1 text-sm text-slate">{text}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function Row({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate">{label}</dt>
      <dd className={`text-right text-ink ${mono ? "break-all font-mono text-xs" : ""} ${strong ? "font-medium" : ""}`}>{value}</dd>
    </div>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-card bg-ink px-5 py-2.5 text-center text-sm text-paper hover:bg-ink/90">
      {children}
    </Link>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-paper">
          <Loader2 className="animate-spin text-clay" />
        </main>
      }
    >
      <ReturnContent />
    </Suspense>
  );
}
