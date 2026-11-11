"use client";

import type { DictKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useId, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  CHECKOUT_METHODS,
  PAYMENT_METHODS,
  methodRequiresPhone,
  validateMobileMoneyPhone,
  type PaymentMethodId,
} from "@/lib/payment-methods";
import { DEFAULT_COUNTRY, getCountry } from "@/lib/payment-countries";
import { usePaymentMethods, type PaymentMethodsState } from "@/lib/use-payment-methods";

/**
 * Choix du moyen de paiement : MTN MoMo · Orange Money · Visa / Mastercard · PayPal.
 *   MTN MoMo → champ « Numéro de téléphone » OBLIGATOIRE : la demande de paiement est envoyée à ce numéro, le client la confirme
 *              lui-même chez l'opérateur (Study Helper ne voit jamais le code secret).
 *   Orange Money / Visa / Mastercard / PayPal → page officielle du prestataire : aucune donnée de carte ni code ici.
 * Seuls les moyens RÉELLEMENT disponibles dans le pays sont proposés (jamais un moyen non configuré présenté comme opérationnel).
 * Le parent garde `value` et `phone`, et valide de nouveau au clic sur « Payer ».
 */
export default function PaymentMethodSelector({
  value,
  onChange,
  phone,
  onPhoneChange,
  phoneError,
  disabled = false,
  country = DEFAULT_COUNTRY,
  allowed,
  availability,
}: {
  value: PaymentMethodId | null;
  onChange: (id: PaymentMethodId) => void;
  phone: string;
  onPhoneChange: (phone: string) => void;
  /** Erreur imposée par le parent (ex. au clic sur « Payer »). */
  phoneError?: string | null;
  disabled?: boolean;
  /** Pays choisi par l'utilisateur (ISO) : détermine les moyens proposés et le format du numéro. */
  country?: string;
  /** Restreint les moyens proposés (ex. cours particuliers : Mobile Money en francs CFA uniquement). */
  allowed?: PaymentMethodId[];
  /** Disponibilité déjà chargée par le parent ; sinon le sélecteur la charge lui-même. */
  availability?: PaymentMethodsState;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const [touched, setTouched] = useState(false);

  const own = usePaymentMethods(country, Boolean(availability));
  const state = availability ?? own;
  const countryInfo = getCountry(country);
  const methods = CHECKOUT_METHODS.filter((id) => state.methods[id]?.available && (!allowed || allowed.includes(id)));
  const needsPhone = value !== null && methodRequiresPhone(value);
  let liveError: string | null = null;
  if (needsPhone && touched) {
    const check = validateMobileMoneyPhone(phone, country);
    liveError = check.ok ? null : country === DEFAULT_COUNTRY ? t("pay.err.phone_invalid") : t("pay.err.phone_invalid_country", { example: countryInfo?.example ?? "" });
  }
  const error = phoneError ?? liveError;

  return (
    <div className="mt-3 space-y-3">
      <div role="radiogroup" aria-label={t("pay.title")} className="space-y-2">
        {state.loading && <p role="status" className="text-sm text-slate">{t("common.loading" as DictKey)}</p>}
        {!state.loading && methods.length === 0 && <p role="status" className="rounded-card bg-mist2 px-3 py-2 text-sm text-slate">{t("pay.country.method_none")}</p>}
        {methods.map((id) => {
          const method = PAYMENT_METHODS[id];
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(id)}
              className={`flex w-full items-center gap-3 rounded-card border px-3 py-2.5 text-left transition disabled:opacity-60 ${
                selected ? "border-clay bg-clay/5 ring-1 ring-clay" : "border-mist hover:border-ink"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={method.logo}
                alt=""
                width={72}
                height={29}
                className="block h-[29px] w-[72px] shrink-0 rounded-md bg-white object-contain"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{t(`pay.method.${id}` as DictKey)}</span>
                <span className="block text-xs text-slate">{method.flow === "push" ? t("pay.tagline.push") : t("pay.tagline.card")}</span>
              </span>
              <span
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 rounded-full border ${
                  selected ? "border-clay bg-clay shadow-[inset_0_0_0_3px_white]" : "border-mist"
                }`}
              />
            </button>
          );
        })}
      </div>

      {needsPhone && value && (
        <div>
          <label htmlFor={fieldId} className="block text-xs text-slate">
            {t("pay.phone.label")} {t(`pay.method.${value}` as DictKey)} <span className="text-clay">*</span>
          </label>
          <input
            id={fieldId}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : `${fieldId}-hint`}
            placeholder={countryInfo?.example ?? "6XX XXX XXX"}
            value={phone}
            disabled={disabled}
            onChange={(e) => onPhoneChange(e.target.value)}
            onBlur={() => setTouched(true)}
            className={`mt-1 w-full rounded-card border px-3 py-2 text-sm text-ink focus:outline-none ${
              error ? "border-clay" : "border-mist focus:border-ink"
            }`}
          />
          {error ? (
            <p id={`${fieldId}-error`} role="alert" className="mt-1 text-xs text-clay">
              {error}
            </p>
          ) : (
            <p id={`${fieldId}-hint`} className="mt-1 text-xs text-slate">
              {t("pay.phone.help")}
            </p>
          )}
        </div>
      )}

      {value && !needsPhone && (
        <p className="text-xs text-slate">
          {t("pay.card.help")}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-card bg-mist2 px-3 py-2 text-xs text-slate">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-forest" />
        <span>
          {t("pay.noSecrets")}
        </span>
      </p>
    </div>
  );
}
