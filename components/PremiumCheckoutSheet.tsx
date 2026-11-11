"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { paymentErrorMessage } from "@/lib/i18n/translate";
import type { DictKey } from "@/lib/i18n/dictionaries";
import { useEffect, useMemo, useState } from "react";
import { Crown, Loader2, X } from "lucide-react";
import PaymentMethodSelector from "./PaymentMethodSelector";
import { PaymentError, startPayment } from "@/lib/api";
import { usePaymentMethods } from "@/lib/use-payment-methods";
import { PAYMENT_METHODS, methodRequiresPhone, validateMobileMoneyPhone, type PaymentMethodId } from "@/lib/payment-methods";
import { formatDateFr, premiumPriceFor, type Term } from "@/lib/premium";
import { DEFAULT_COUNTRY, countryFlag, countryName, enabledCountryCodes, formatMoney, getCountry, isCfaCurrency, suggestCountry } from "@/lib/payment-countries";
import type { PlanOffer, PremiumOverview } from "@/lib/billing/types";

const DAY_MS = 86_400_000;

/**
 * Fiche de paiement Premium (ouverte par « S'abonner à Premium » / « Renouveler »).
 * Le prix et la durée affichés viennent du SERVEUR (/api/premium/status) : le navigateur
 * ne peut pas les modifier, et le serveur les recalcule de toute façon à chaque paiement.
 * Cliquer sur « Payer » n'active JAMAIS Premium : seule la vérification du paiement par
 * le serveur auprès du prestataire l'active (page de confirmation /payments/return).
 */
export default function PremiumCheckoutSheet({
  open,
  onClose,
  overview,
}: {
  open: boolean;
  onClose: () => void;
  overview: PremiumOverview;
}) {
  const [planId, setPlanId] = useState<Term | null>(null);
  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, lang } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [resumeRef, setResumeRef] = useState<string | null>(null);
  // Pays : proposé d'après la langue du navigateur (jamais l'adresse IP), toujours modifiable par l'utilisateur.
  const enabledCountries = useMemo(() => enabledCountryCodes(), []);
  const [country, setCountry] = useState<string>(() =>
    suggestCountry(typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [], enabledCountryCodes()),
  );
  // Moyens réellement disponibles dans ce pays (serveur : identifiants configurés, opérateur présent) + devise de chacun.
  const pm = usePaymentMethods(country);

  const offers = overview.plans;
  const offer = useMemo(() => offers.find((o) => o.id === planId) ?? offers[0] ?? null, [offers, planId]);
  const sub = overview.subscription;
  const pending = overview.pendingPayment;

  // Fermeture au clavier (Échap) + page figée derrière la fiche.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  // Devise selon le moyen : Mobile Money = devise du pays ; carte / PayPal = devise du prestataire (ex. EUR). CFA = prix du serveur ;
  // autre devise = tableau de tarifs explicite, sinon « — » (non payable) : jamais de prix converti ou inventé.
  const countryCurrency = getCountry(country)?.currency ?? "XAF";
  const currencyOf = (m: PaymentMethodId | null) => (m ? pm.methods[m]?.currency : undefined) ?? countryCurrency;
  const priceFor = (o: PlanOffer, m: PaymentMethodId | null = null): number | null => {
    const cur = currencyOf(m);
    return isCfaCurrency(cur) ? o.price : premiumPriceFor(overview.accountType, o.id, cur);
  };
  const fmt = (o: PlanOffer, m: PaymentMethodId | null = null) => {
    const p = priceFor(o, m);
    return p === null ? "—" : formatMoney(p, currencyOf(m), lang);
  };

  // Dates affichées : renouvellement = on PROLONGE la période restante ; expiré = nouvelle période dès la confirmation.
  const expiresMs = sub.expiresAt ? new Date(sub.expiresAt).getTime() : NaN;
  const activeWithDate = sub.isActive && Number.isFinite(expiresMs);
  const newExpiryIso = offer
    ? new Date((activeWithDate ? expiresMs : Date.now()) + offer.durationDays * DAY_MS).toISOString()
    : null;

  async function handlePay() {
    if (!offer) return;
    if (!method) {
      setError(t("pay.choose"));
      return;
    }
    if (priceFor(offer, method) === null) {
      setError(t("pay.err.currency_unavailable"));
      return;
    }
    if (!pm.methods[method]?.available) {
      setError(t("pay.err.method_unavailable_country"));
      return;
    }
    // MTN MoMo : le numéro est obligatoire et doit être valide — sinon aucun paiement n'est lancé.
    if (methodRequiresPhone(method)) {
      const check = validateMobileMoneyPhone(phone, country);
      if (!check.ok) {
        setPhoneError(country === DEFAULT_COUNTRY ? t("pay.err.phone_invalid") : t("pay.err.phone_invalid_country", { example: getCountry(country)?.example ?? "" }));
        setError(null);
        return;
      }
    }
    setPhoneError(null);
    setError(null);
    setResumeRef(null);
    setBusy(true);
    try {
      const result = await startPayment({ type: "premium", plan: offer.id, method, phone, country });
      // Orange Money / carte / PayPal : page officielle du prestataire. MTN MoMo : confirmation sur le
      // téléphone — la page de suivi vérifie le paiement côté serveur sans activer Premium prématurément.
      window.location.href = result.paymentUrl ?? `/payments/return?ref=${encodeURIComponent(result.ref)}`;
    } catch (err) {
      setBusy(false);
      if (err instanceof PaymentError && err.code === "payment_pending" && err.ref) setResumeRef(err.ref);
      // Message dans la langue de l'utilisateur : traduit d'après le code d'erreur du serveur.
      const translated = err instanceof PaymentError ? paymentErrorMessage(lang, err.code) : null;
      setError(translated ?? (err instanceof PaymentError ? err.message : t("error.network")));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-ink/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-sheet-title"
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Crown size={20} className="text-gold" />
            <h2 id="premium-sheet-title" className="font-display text-xl text-ink">
              Premium
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer la fiche de paiement"
            className="rounded-full p-1 text-slate hover:bg-mist2 hover:text-ink disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {!offer ? (
          <p className="text-sm text-slate">Aucune offre Premium n&apos;est disponible pour votre profil.</p>
        ) : (
          <>
            {offers.length > 1 && (
              <div role="radiogroup" aria-label="Durée" className="mb-3 grid grid-cols-3 gap-2">
                {offers.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={o.id === offer.id}
                    disabled={busy}
                    onClick={() => setPlanId(o.id)}
                    className={`rounded-card border px-2 py-2 text-center text-xs ${
                      o.id === offer.id ? "border-clay bg-clay/5 text-ink" : "border-mist text-slate hover:border-ink"
                    }`}
                  >
                    <span className="block">{o.durationDays} jours</span>
                    <span className="block font-display text-sm text-ink">{fmt(o)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5 rounded-card bg-mist2 px-4 py-3 text-sm text-ink">
              <p>
                Prix : <strong>{fmt(offer, method)}</strong>
              </p>
              <p>
                Validité : <strong>{offer.durationDays} jours</strong>
              </p>
              {sub.expiresAt && (
                <p>
                  {sub.isActive ? "Votre Premium expire le : " : "Votre Premium a expiré le : "}
                  <strong>{formatDateFr(sub.expiresAt)}</strong>
                </p>
              )}
              {newExpiryIso && (
                <p className="border-t border-mist pt-1.5 text-forest">
                  {activeWithDate ? "Après renouvellement, il expirera le : " : "Nouvelle période, jusqu'au : "}
                  <strong>{formatDateFr(newExpiryIso)}</strong>
                </p>
              )}
            </div>
            {activeWithDate && (
              <p className="mt-1.5 text-xs text-slate">
                Votre Premium est encore actif : la nouvelle période s&apos;ajoute à la durée restante, rien n&apos;est perdu.
              </p>
            )}

            {pending ? (
              <div className="mt-4 rounded-card border border-gold/60 bg-gold/10 p-3 text-sm text-ink">
                <p className="font-medium">Paiement en cours de vérification</p>
                <p className="mt-1 text-xs text-slate">
                  Un paiement Premium est déjà en attente de confirmation. Terminez-le ou annulez-le avant d&apos;en lancer un autre.
                </p>
                <a
                  href={`/payments/return?ref=${encodeURIComponent(pending.ref)}`}
                  className="mt-2 inline-block rounded-card bg-ink px-3 py-1.5 text-xs text-paper hover:bg-ink/90"
                >
                  Voir le paiement en cours
                </a>
              </div>
            ) : (
              <>
                {enabledCountries.length > 1 && (
                  <div className="mt-4">
                    <label htmlFor="pay-country" className="block text-xs font-medium text-slate">
                      {t("pay.country")}
                    </label>
                    <select
                      id="pay-country"
                      value={country}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCountry(next);
                        setMethod(null);
                        setPhoneError(null);
                        setError(null);
                      }}
                      className="mt-1 w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
                    >
                      {enabledCountries.map((code) => (
                        <option key={code} value={code}>
                          {countryFlag(code)} {countryName(code, lang)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate">{t("pay.country.hint")}</p>
                  </div>
                )}
                <h3 className="mt-4 font-display text-sm text-ink">Choisir un moyen de paiement</h3>
                <PaymentMethodSelector
                  country={country}
                  availability={pm}
                  value={method}
                  onChange={(id) => {
                    setMethod(id);
                    setPhoneError(null);
                    setError(null);
                  }}
                  phone={phone}
                  onPhoneChange={(v) => {
                    setPhone(v);
                    setPhoneError(null);
                  }}
                  phoneError={phoneError}
                  disabled={busy}
                />

                <button
                  type="button"
                  onClick={handlePay}
                  disabled={busy || !method}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-gold px-4 py-3 text-sm font-medium text-ink hover:bg-gold/90 disabled:opacity-60"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
                  {busy
                    ? t("common.loading")
                    : method
                      ? `${t("pay.button")} ${fmt(offer, method)} — ${t(`pay.method.${method}` as DictKey)}`
                      : t("pay.title")}
                </button>
              </>
            )}

            {error && (
              <div role="alert" className="mt-3 text-sm text-clay">
                <p>{error}</p>
                {resumeRef && (
                  <a
                    href={`/payments/return?ref=${encodeURIComponent(resumeRef)}`}
                    className="mt-1 inline-block text-xs underline"
                  >
                    Reprendre le paiement en cours
                  </a>
                )}
              </div>
            )}

            <p className="mt-3 text-[11px] leading-snug text-slate/70">
              Premium n&apos;est activé qu&apos;après la confirmation réelle de votre paiement par nos serveurs — une simple
              redirection ou un clic ne suffit jamais.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
